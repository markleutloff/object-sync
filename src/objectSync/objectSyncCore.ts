import {
  ChangeMessageType,
  CreateMessageType,
  CreateObjectMessage,
  DeleteMessageType,
  DeleteObjectMessage,
  ExecuteFinishedMessageType,
  ExecuteMessageType,
  isCreateObjectMessage,
  isDeleteObjectMessage,
  Message,
  ClientToken,
  ClientConnectionSettings,
  createDisposable,
  IDisposable,
  Constructor,
  forEachIterable,
  isIterable,
  isPrimitiveValue,
  SerializedValue,
  OneOrMany,
  EventEmitter,
} from "../shared/index.js";
import { SyncAgent, ISyncObjectSyncAgent, IArraySyncAgent, IMapSyncAgent, ISetSyncAgent, ObjectInfo, ISyncAgent, SyncAgentProvider } from "../syncAgents/index.js";
import { ObjectPool } from "./objectPool.js";
import { WeakObjectPool } from "./weakObjectPool.js";
import { ExchangeMessagesSettings, FinalizedObjectSyncSettings, ObjectSyncSettings } from "./types.js";
import { SyncAgentProviders } from "./syncAgentProviders.js";
import { ObjectsView, RootObjectsView } from "./objectsView.js";

export type TrackedObjectDisposable<TInstance extends object> = IDisposable & {
  readonly objectId: string;
  readonly instance: TInstance | undefined;
};

type SyncAgentType<TInstance> =
  TInstance extends Array<infer TItem>
    ? IArraySyncAgent<TItem>
    : TInstance extends Set<infer TItem>
      ? ISetSyncAgent<TItem>
      : TInstance extends Map<infer TKey, infer TValue>
        ? IMapSyncAgent<TKey, TValue>
        : TInstance extends object
          ? ISyncObjectSyncAgent<TInstance>
          : never;

export type SyncAgentOrFallback<TDispatcher extends ISyncAgent | null, TInstance> = TDispatcher extends null ? SyncAgentType<TInstance> : TDispatcher;

export type ObjectSyncEventMap = {
  tracked(instance: object, syncAgent: ISyncAgent): void;
};

export class ObjectSyncCore extends EventEmitter<ObjectSyncEventMap> {
  private readonly _objectPool = new ObjectPool();
  private readonly _weakObjectPool: WeakObjectPool | null = null;
  private readonly _objectsWithPendingMessages = new Set<object>();
  private readonly _clients: Set<ClientToken> = new Set();
  private readonly _settings: FinalizedObjectSyncSettings;
  private readonly _pendingWeakDeletes: { objectId: string; clients: Set<ClientToken> }[] = [];
  private _nextObjectId = 1;

  private _pendingCreateMessageByObjectId: Map<string, CreateObjectMessage> = new Map();
  private readonly _ownClientToken: ClientToken;

  private readonly _syncAgentProviders: SyncAgentProviders;

  private readonly _allObjects: ObjectsView;
  private readonly _rootObjects: RootObjectsView;
  private readonly _pendingPromise: Promise<any>[] = [];

  constructor(settings: ObjectSyncSettings) {
    super();
    this._syncAgentProviders = new SyncAgentProviders(settings);
    this._settings = {
      identity: settings.identity,
      objectIdGeneratorSettings: settings.objectIdGeneratorSettings ?? {
        prefix: settings.identity,
      },
      arrayChangeSetMode: settings.arrayChangeSetMode ?? "compareStates",
      memoryManagementMode: settings.memoryManagementMode ?? "byClient",
    };
    if (this._settings.memoryManagementMode === "weak") {
      this._weakObjectPool = new WeakObjectPool();
      this._weakObjectPool.on("freed", (objectId, clients) => {
        this._pendingWeakDeletes.push({ objectId, clients });
      });
    }

    this._ownClientToken = this.registerClient({ identity: settings.identity });

    this._allObjects = new ObjectsView(this);
    this._rootObjects = new RootObjectsView(this);

    if (settings.allowedRootTypesFromClient) {
      this._rootObjects.allowedRootTypesFromClient = settings.allowedRootTypesFromClient;
    }
  }

  get allObjects() {
    return this._allObjects;
  }

  get rootObjects() {
    return this._rootObjects;
  }

  get settings() {
    return this._settings;
  }

  get arrayChangeSetMode() {
    return this._settings.arrayChangeSetMode;
  }

  reportPendingMessagesForObject(objectInfo: ObjectInfo) {
    if (!objectInfo.instance) return;
    this._objectsWithPendingMessages.add(objectInfo.instance);
  }

  generateObjectId(value?: object): string {
    if ("generateId" in this._settings.objectIdGeneratorSettings) {
      return this._settings.objectIdGeneratorSettings.generateId(value);
    } else {
      return `${this._settings.objectIdGeneratorSettings.prefix}-${this._nextObjectId++}`;
    }
  }

  registerClient(settingsOrIdentity: ClientConnectionSettings | string): ClientToken {
    const clientToken = new ClientToken(typeof settingsOrIdentity === "string" ? settingsOrIdentity : settingsOrIdentity.identity);
    this._clients.add(clientToken);
    return clientToken;
  }

  get registeredClientTokens() {
    return Array.from(this._clients).filter((c) => c !== this._ownClientToken);
  }

  /**
   * Removes all client-specific state for a client (e.g., when disconnecting).
   */
  unregisterClient(clientToken: ClientToken): void {
    if (!this._clients.has(clientToken)) {
      throw new Error("Unknown client token");
    }

    this._objectPool.infos.forEach((info) => {
      info.syncAgent.onClientUnregistered(clientToken);
    });

    this._clients.delete(clientToken);
  }

  /**
   * Gets the identity of this ObjectSync instance.
   */
  get identity() {
    return this._settings.identity;
  }

  get syncAgentProviders() {
    return this._syncAgentProviders;
  }

  /**
   * Tracks an object for synchronization.
   * Must be called for root objects you want to track. Tracked root objects will never be automatically deleted.
   * @param instance The instance to track.
   * @param objectId Optional object ID to use for the tracked object. If not provided, a new object ID will be generated.
   * @return A disposable which can be used to untrack the object and access the tracked object's ID and instance (when still tracked).
   */
  track<T extends object>(instance: T, objectId?: string): TrackedObjectDisposable<T> {
    const info = this.trackInternal(instance, objectId);
    if (!info) {
      throw new Error("Cannot track primitive value as root.");
    }
    info.isRoot = true;
    info.syncAgent.clients.add(this._ownClientToken);

    const that = this;
    return createDisposable(
      () => {
        if (info.isRoot) {
          info.isRoot = false;
        }
      },
      {
        get objectId() {
          return info.objectId;
        },
        get instance() {
          return that._objectPool.getObjectById<T>(objectId!);
        },
      },
    );
  }

  trackInternal(instance: object, objectId?: string): ObjectInfo | null {
    // Primitives are not trackable
    if (isPrimitiveValue(instance)) return null;

    // Grab directly by instance when possible, thats the easiest case and also the one we expect to be the most common
    let info = this._objectPool.getInfoByObject(instance);
    if (info) return info;

    // Allow retracking from weak pool if enabled
    if (this._settings.memoryManagementMode === "weak") {
      const info = this._weakObjectPool!.extractByInstance(instance);
      if (info) {
        this._objectPool.add(info);
        return info;
      }
    }

    // If objectId is provided, try to find the object by id. This happens when we already have an object id but without a set instance.
    // Now we have a instance, we can set on the info and finish the serializer initialization.
    if (objectId !== undefined) {
      info = this._objectPool.getInfoById(objectId!);
      if (info) {
        this._objectPool.onObjectSet(info);
        return info;
      }
    }

    // Otherwise we create a new info for the instance, which will generate a new object id if needed.
    info = new ObjectInfo(this, objectId, instance);
    info.isOwned = true;
    this._objectPool.add(info);
    info.initializeSyncAgent(instance);

    this.emit("tracked", instance, info.syncAgent);

    return info;
  }

  /**
   * Untracks an object from synchronization.
   * Untracked objects are no longer prevented from being deleted and will be removed from clients when they are no longer used by them.
   * @param instance The instance to untrack.
   * @return True if the instance was untracked, false if it was not being tracked as a root object.
   */
  untrack(instance: object): boolean {
    // We just remove the root flag, actual removal happens during message generation
    const info = this._objectPool.getInfoByObject(instance);
    if (!info || !info.isRoot || !info.isOwned) return false;

    info.isRoot = false;
    return true;
  }

  /**
   * Internal use only: Called by ObjectInfo.
   */
  reportInstanceCreated(instance: object, objectId: string) {
    this.trackInternal(instance, objectId);
  }

  private handleCreateMessage(message: CreateObjectMessage, clientToken: ClientToken) {
    this._pendingCreateMessageByObjectId.delete(message.objectId);

    if (message.isRoot && !this.rootObjects.isTypeFromClientAllowed(message.typeId)) throw new Error(`Type ${message.typeId}, sent from '${clientToken.identity}' is not allowed as root type.`);

    const info: ObjectInfo = new ObjectInfo(this, message.objectId, message.typeId);
    if (message.isRoot) info.isRoot = true;

    this._objectPool.add(info);
    info.initializeSyncAgent(message.typeId);
    info.syncAgent.clients.add(clientToken);

    info.syncAgent.applyMessage(message, clientToken);
  }

  private handleOtherMessage(message: Message, clientToken: ClientToken) {
    const info = this._objectPool.getInfoById(message.objectId);
    if (!info) return;

    info.syncAgent.applyMessage(message, clientToken);
  }

  private handleDeleteMessage(message: DeleteObjectMessage, clientToken: ClientToken) {
    const info = this._objectPool.getInfoById(message.objectId);
    if (!info) return;

    info.syncAgent.applyMessage(message, clientToken);
    this._objectPool.deleteById(message.objectId);
  }

  public serializeValue(value: any, clientToken: ClientToken): SerializedValue {
    if (isPrimitiveValue(value)) {
      return {
        value,
      };
    }

    const objectInfo = this.trackInternal(value as any)!;
    const typeId = objectInfo.syncAgent.getTypeId(clientToken);
    if (typeId === undefined || typeId === null) {
      return undefined;
    }

    return { objectId: objectInfo.objectId, typeId };
  }

  private checkIsTypeAllowed(value: SerializedValue, allowedTypes?: (Constructor | undefined | null)[]) {
    if (allowedTypes === undefined) return;

    if (value === undefined && !allowedTypes.includes(undefined)) {
      throw new Error(`Value undefined is not allowed. Allowed types: ${allowedTypes.map((t) => (t === undefined ? "undefined" : t === null ? "null" : t.name)).join(", ")}`);
    }
    if (value === undefined) {
      return;
    } else if (!("objectId" in value)) {
      let typeToTest: any = undefined;
      if (value.value === null) {
        typeToTest = null;
      } else if (value.value === undefined) {
        typeToTest = undefined;
      } else if (typeof value.value === "number") {
        typeToTest = Number;
      } else if (typeof value.value === "string") {
        typeToTest = String;
      } else if (typeof value.value === "boolean") {
        typeToTest = Boolean;
      }

      if (!allowedTypes.includes(typeToTest)) {
        throw new Error(`Value ${value.value} is not allowed. Allowed types: ${allowedTypes.map((t) => (t === undefined ? "undefined" : t === null ? "null" : t.name)).join(", ")}`);
      }
    } else {
      let provider: SyncAgentProvider | null = null;
      const obj = this._objectPool.getObjectById(value.objectId); // Just check if object exists, type will be checked when processing the create message
      if (!obj) {
        const pendingCreateMessage = this._pendingCreateMessageByObjectId.get(value.objectId);
        if (pendingCreateMessage) {
          const typeId = pendingCreateMessage.typeId;
          provider = this.syncAgentProviders.find(typeId);
          if (!provider || !allowedTypes.includes(provider.syncType)) throw new Error(`Not allowed typeId ${typeId}.`);
        } else {
          throw new Error(`Object with id ${value.objectId} not found`);
        }
      } else {
        const type = obj.constructor;
        provider = this.syncAgentProviders.find(type);
        if (!provider || !allowedTypes.includes(provider.syncType)) throw new Error(`Not allowed type ${type.name}.`);
      }
    }
  }

  public deserializeValue(value: SerializedValue, clientToken: ClientToken, allowedTypes?: (Constructor | undefined | null)[]) {
    this.checkIsTypeAllowed(value, allowedTypes);

    if (value === undefined) return undefined;

    if (!("objectId" in value)) {
      return value.value;
    }

    const objectId = value.objectId;
    let instance = this._objectPool.getObjectById(objectId);
    if (instance) return instance;

    // We find the pending create message which may create the instance we search for
    const createMessage = this._pendingCreateMessageByObjectId.get(objectId);
    if (!createMessage) throw new Error(`Object with id ${objectId} not found`);
    this.handleCreateMessage(createMessage, clientToken);

    instance = this._objectPool.getObjectById(objectId);
    if (!instance) throw new Error(`Object with id ${objectId} not found after processing create message`);

    return instance;
  }

  public async applyMessagesAsync(messagesOrMessagesByClient: Message[] | Map<ClientToken, Message[]>, clientToken?: ClientToken): Promise<void> {
    this.applyMessages(messagesOrMessagesByClient, clientToken);
    await this.awaitPendingPromises();
  }

  public applyMessages(messagesOrMessagesByClient: Message[] | Map<ClientToken, Message[]>, clientToken?: ClientToken): Promise<any>[] {
    if (messagesOrMessagesByClient instanceof Map) {
      for (const [clientToken, messages] of messagesOrMessagesByClient) {
        this.applyMessages(messages, clientToken);
      }
      return this._pendingPromise;
    }

    let messages = messagesOrMessagesByClient as Message[];
    if (this._clients.has(clientToken!) === false) {
      throw new Error("Unknown client token received messages from.");
    }

    this.sortMessages(messages);

    // extract all creation messages and remove them from the main list
    const creationMessages = messages.filter(isCreateObjectMessage);
    messages = messages.filter((m) => !isCreateObjectMessage(m));

    // Store all create messages in pending map for deferred resolution
    for (const creationMessage of creationMessages) {
      this._pendingCreateMessageByObjectId.set(creationMessage.objectId, creationMessage);
    }
    // Process all messages that are for root objects first
    const rootCreationMessages = creationMessages.filter((m) => m.isRoot);
    for (const creationMessage of rootCreationMessages) {
      if (this._pendingCreateMessageByObjectId.has(creationMessage.objectId)) this.handleCreateMessage(creationMessage, clientToken!);
    }

    // Process all other messages
    for (const message of messages) {
      if (isDeleteObjectMessage(message)) this.handleDeleteMessage(message as DeleteObjectMessage, clientToken!);
      else this.handleOtherMessage(message, clientToken!);
    }

    return this._pendingPromise;
  }

  private sortMessages(messages: Message[]) {
    // Order:
    // 1. Creation messages (in the order they are received, regardless of client)
    // 2. Change messages (in the order they are received)
    // 3. Execute messages (in the order they are received)
    // 4. Execute finished messages (in the order they are received)
    // 5. Everything unknown
    // 6. Delete messages (in the order they are received)
    messages.sort((a, b) => {
      if (a.type === b.type) return 0;

      if (a.type === CreateMessageType) return -1;
      if (b.type === CreateMessageType) return 1;

      if (a.type === ChangeMessageType) return -1;
      if (b.type === ChangeMessageType) return 1;

      if (a.type === ExecuteMessageType) return -1;
      if (b.type === ExecuteMessageType) return 1;

      if (a.type === ExecuteFinishedMessageType) return -1;
      if (b.type === ExecuteFinishedMessageType) return 1;

      if (a.type === DeleteMessageType) return 1;
      if (b.type === DeleteMessageType) return -1;
      return 0;
    });
  }

  /**
   * Clears internal states, which are needed to store changes between synchronization cycles. Should be called after messages have been collected for all clients.
   */
  public clearStates() {
    this._objectPool.infos.forEach((info) => {
      info.syncAgent.clearStates();
    });

    this._objectPool.orphanedObjectInfos(this._ownClientToken).forEach((info) => {
      if (this._objectsWithPendingMessages.has(info.instance!)) return;
      this._objectPool.deleteByObject(info.instance!);
    });

    this._objectsWithPendingMessages.clear();
    this._pendingWeakDeletes.length = 0;
  }

  getMessages(clientOrClientsOrCallTick?: boolean | OneOrMany<ClientToken>, clearNonClientStates: boolean = true): Map<ClientToken, Message[]> | Message[] {
    let result: Map<ClientToken, Message[]>;
    let clientTokens: OneOrMany<ClientToken> | undefined;
    if (typeof clientOrClientsOrCallTick === "boolean" || clientOrClientsOrCallTick === undefined) {
      clientTokens = undefined;
      clearNonClientStates = clientOrClientsOrCallTick ?? true;
    } else if (!isIterable(clientOrClientsOrCallTick)) {
      clientTokens = clientOrClientsOrCallTick;
    }

    result = this.getMessagesForClients(clientTokens ?? this._clients, clearNonClientStates);

    if (clientTokens === undefined || isIterable(clientTokens)) return result;
    return result.get(clientTokens)!;
  }

  private getMessagesForClients(clientOrClientTokens: OneOrMany<ClientToken>, clearNonClientStates: boolean): Map<ClientToken, Message[]> {
    const resultByClient = new Map<ClientToken, Message[]>();
    forEachIterable(clientOrClientTokens!, (clientToken) => {
      if (clientToken === this._ownClientToken) return;

      const generatedMessages: Message[] = [];
      const serializersWhichsStatesNeedsToBeCleared: Set<SyncAgent<any>> = new Set();

      for (const instance of this._objectsWithPendingMessages) {
        const objectInfo = this.trackInternal(instance)!;
        if (!objectInfo.syncAgent.isForClientToken(clientToken)) continue;
        serializersWhichsStatesNeedsToBeCleared.add(objectInfo.syncAgent);

        const isNewInstance = objectInfo.syncAgent.clients.has(clientToken) === false;
        if (isNewInstance) {
          objectInfo.syncAgent.clients.add(clientToken);
        }
        const messages = objectInfo.syncAgent.generateMessages(clientToken, isNewInstance);
        generatedMessages.push(...messages);
      }

      for (const serializer of serializersWhichsStatesNeedsToBeCleared) serializer.clearStates(clientToken);

      while (true) {
        let noLongerTrackedByClient = this._objectPool.objectInfosToDelete(clientToken);
        noLongerTrackedByClient = noLongerTrackedByClient.filter((o) => !this._objectsWithPendingMessages.has(o.instance));
        if (noLongerTrackedByClient.length === 0) {
          break;
        }
        for (const objectInfo of noLongerTrackedByClient) {
          if (this._settings.memoryManagementMode === "byClient") {
            objectInfo.syncAgent.onClientUnregistered(clientToken);
            generatedMessages.push({
              type: "delete",
              objectId: objectInfo.objectId,
            });
          } else {
            this._weakObjectPool!.add(objectInfo);
            this._objectPool.deleteById(objectInfo.objectId);
          }
        }
      }

      for (const pendingWeakDelete of this._pendingWeakDeletes) {
        if (pendingWeakDelete.clients.has(clientToken)) {
          generatedMessages.push({
            type: "delete",
            objectId: pendingWeakDelete.objectId,
          });
          pendingWeakDelete.clients.delete(clientToken);
        }
      }

      resultByClient.set(clientToken, generatedMessages);
    });

    if (clearNonClientStates) this.clearStates();

    return resultByClient;
  }

  findOne<T extends object>(constructorOrObjectId: Constructor<T> | string, objectId?: string, predicate?: (info: ObjectInfo) => boolean) {
    if (typeof constructorOrObjectId === "string") {
      return this._objectPool.getObjectById(constructorOrObjectId) as T | undefined;
    }
    return this._objectPool.findOne(constructorOrObjectId, objectId, predicate);
  }

  /**
   * Finds all tracked objects of a specific type.
   * @param constructor The constructor of the object type to find.
   * @returns An array of found objects.
   */
  findAll<T extends object>(constructor?: Constructor<T>, predicate?: (info: ObjectInfo) => boolean) {
    return this._objectPool.findAll(constructor, predicate);
  }

  /**
   * Exchanges messages with clients by sending messages and receiving client messages.
   * @param settings Settings for exchanging messages.
   */
  async exchangeMessagesAsync(settings: ExchangeMessagesSettings): Promise<void> {
    const messages = (settings.clients ? this.getMessages(settings.clients) : this.getMessages()) as Map<ClientToken, Message[]>;

    if (settings.clientMessageFilter) {
      for (const [clientToken, clientMessages] of messages) {
        const filteredMessages = clientMessages.filter((message) => settings.clientMessageFilter!(clientToken, message, false));
        messages.set(clientToken, filteredMessages);
      }
    }

    let responseMessagesByClient: Map<ClientToken, Message[] | Promise<Message[]>>;

    if ("sendToClientAsync" in settings) {
      responseMessagesByClient = new Map<ClientToken, Promise<Message[]>>();
      for (const [clientToken, clientMessages] of messages) {
        const responseMessagesFromClient = settings.sendToClientAsync(clientToken, clientMessages);
        responseMessagesByClient.set(clientToken, responseMessagesFromClient);
      }
      await Promise.allSettled(responseMessagesByClient.values());
    } else {
      responseMessagesByClient = await settings.sendToClientsAsync(messages);
    }

    for (const [clientToken, resultsPromise] of responseMessagesByClient) {
      try {
        let messagesFromClient = await resultsPromise;

        if (settings.clientMessageFilter) {
          messagesFromClient = messagesFromClient.filter((message) => settings.clientMessageFilter!(clientToken, message, true));
        }

        await this.applyMessagesAsync(messagesFromClient, clientToken);
      } catch (error) {
        settings.errorHandler?.(clientToken, error);
      }
    }
  }

  /**
   * Gets the dispatcher associated with a tracked object instance.
   * A dispatcher is different for each kind of object and returned by its associated serializer.
   * USe this to configure ninstance based serializer settings.
   * @param instance The tracked object instance.
   * @returns The dispatcher associated with the object instance, or null if none exists.
   */
  getSyncAgent<TDispatcher extends ISyncAgent | null = null, TInstance extends object = any>(instance: TInstance): SyncAgentOrFallback<TDispatcher, typeof instance> {
    let info = this._objectPool.getInfoByObject(instance as any);
    if (!info) {
      info = this.trackInternal(instance) ?? undefined;
      if (!info) {
        throw new Error("Object is not trackable");
      }
    }

    return info.syncAgent as unknown as SyncAgentOrFallback<TDispatcher, typeof instance>;
  }

  getSyncAgentOrNull(instance: any): ISyncAgent | null {
    const info = this._objectPool.getInfoByObject(instance as any);
    if (!info) return null;

    return info.syncAgent;
  }

  registerPendingPromise(promise: Promise<any>) {
    this._pendingPromise.push(promise);
    promise.finally(() => {
      const index = this._pendingPromise.indexOf(promise);
      if (index >= 0) {
        this._pendingPromise.splice(index, 1);
      }
    });
  }

  private awaitPendingPromises(): Promise<void> {
    return Promise.all(this._pendingPromise).then(() => {});
  }
}
