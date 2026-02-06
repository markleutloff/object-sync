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
} from "../shared/index.js";
import {
  defaultIntrinsicSerializers,
  defaultSerializersOrTypes,
  TypeSerializer,
  ISyncObjectDispatcher,
  IArrayDispatcher,
  IMapDispatcher,
  ISetDispatcher,
  TypeSerializerConstructor,
  ObjectInfo,
  getSerializerSymbol,
  getTrackableTypeInfo,
  getSyncObjectSerializer,
} from "../serialization/index.js";
import { ObjectPool } from "./objectPool.js";
import { ClientTokenFilter } from "../shared/clientFilter.js";
import { WeakObjectPool } from "./weakObjectPool.js";
import { ExchangeMessagesSettings, FinalizedObjectSyncSettings, ObjectSyncSettings } from "./types.js";

export type TrackedObjectDisposable<TInstance extends object> = IDisposable & {
  readonly objectId: string;
  readonly instance: TInstance | undefined;
};

type DispatcherType<TInstance> =
  TInstance extends Array<infer TItem>
    ? IArrayDispatcher<TItem>
    : TInstance extends Set<infer TItem>
      ? ISetDispatcher<TItem>
      : TInstance extends Map<infer TKey, infer TValue>
        ? IMapDispatcher<TKey, TValue>
        : TInstance extends object
          ? ISyncObjectDispatcher<TInstance>
          : never;

type DispatcherOrFallback<TDispatcher, TInstance> = TDispatcher extends null ? DispatcherType<TInstance> : TDispatcher;

export class ObjectSync {
  private readonly _objectPool = new ObjectPool();
  private readonly _weakObjectPool: WeakObjectPool | null = null;
  private readonly _objectsWithPendingMessages = new Set<object>();
  private readonly _clients: Set<ClientToken> = new Set();
  private readonly _settings: FinalizedObjectSyncSettings;
  private readonly _pendingWeakDeletes: { objectId: string; clients: Set<ClientToken> }[] = [];
  private _nextObjectId = 1;

  private _pendingCreateMessageByObjectId: Map<string, CreateObjectMessage> = new Map();
  private readonly _ownClientToken: ClientToken;

  constructor(settings: ObjectSyncSettings) {
    this._settings = {
      identity: settings.identity,
      serializers: (settings.serializers ?? defaultSerializersOrTypes).map(getTypeSerializerClass),
      intrinsicSerializers: settings.intrinsicSerializers ?? defaultIntrinsicSerializers,
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

  /**
   * Registers a new client connection.
   * @param identity The identity of the client connection.
   * @returns The token to the newly registered client connection.
   */
  registerClient(identity: string): ClientToken;

  /**
   * Registers a new client connection.
   * @param settings Settings for the client connection.
   * @returns The token to the newly registered client connection.
   */
  registerClient(settings: ClientConnectionSettings): ClientToken;

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
  removeClient(clientToken: ClientToken): void {
    if (!this._clients.has(clientToken)) {
      throw new Error("Unknown client token");
    }

    this._objectPool.infos.forEach((info) => {
      info.serializer.onClientRemoved(clientToken);
    });

    this._clients.delete(clientToken);
  }

  /**
   * Gets the identity of this ObjectSync instance.
   */
  get identity() {
    return this._settings.identity;
  }

  /** Returns all currently tracked objects. */
  get allTrackedObjects() {
    return this._objectPool.objects;
  }

  /**
   * Sets a client restriction filter for a tracked object.
   * @param obj The tracked object to set the filter for.
   * @param filter The client restriction filter to apply.
   */
  setClientRestriction<T extends object>(obj: T, filter: ClientTokenFilter): void {
    const info = this._objectPool.getInfoByObject(obj);
    if (!info) throw new Error("Object is not tracked");
    info.setClientRestriction(filter);
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
    info.serializer.clients.add(this._ownClientToken);

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

  /**
   * Gets the object ID of a tracked object.
   * @param instance The tracked object instance.
   * @returns The object ID of the tracked object, or null if the object is not tracked.
   */
  getObjectId(instance: object): string | null {
    const info = this._objectPool.getInfoByObject(instance);
    if (!info) return null;
    return info.objectId;
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
    info.initializeSerializer(instance);

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
    if (!info || !info.isRoot) return false;

    info.isRoot = false;
    return true;
  }

  /**
   * Internal use only: Called by ObjectInfo.
   */
  reportInstanceCreated(instance: object, objectId: string) {
    this.trackInternal(instance, objectId);
  }

  /**
   * Internal use only: Called by ObjectInfo.
   */
  findSerializer(instanceOrTypeId: object | string): TypeSerializerConstructor {
    const serializer = this._settings.serializers.find((s) => s.canSerialize(instanceOrTypeId)) ?? this._settings.intrinsicSerializers.find((s) => s.canSerialize(instanceOrTypeId));
    if (!serializer) throw new Error(`No serializer found for value of type ${typeof instanceOrTypeId === "string" ? instanceOrTypeId : instanceOrTypeId.constructor.name}`);
    return serializer;
  }

  private handleCreateMessage(message: CreateObjectMessage, clientToken: ClientToken) {
    this._pendingCreateMessageByObjectId.delete(message.objectId);

    const info: ObjectInfo = new ObjectInfo(this, message.objectId, message.typeId);
    this._objectPool.add(info);
    info.initializeSerializer(message.typeId);
    info.serializer.clients.add(clientToken);

    info.serializer.applyMessage(message, clientToken);
  }

  private handleOtherMessage(message: Message, clientToken: ClientToken) {
    const info = this._objectPool.getInfoById(message.objectId);
    if (!info) return;

    return info.serializer.applyMessage(message, clientToken);
  }

  private handleDeleteMessage(message: DeleteObjectMessage, clientToken: ClientToken) {
    const info = this._objectPool.getInfoById(message.objectId);
    if (!info) return;

    const promiseOrVoid = info.serializer.applyMessage(message, clientToken);
    if (promiseOrVoid instanceof Promise) {
      return promiseOrVoid.then(() => {
        this._objectPool.deleteById(message.objectId);
      });
    }
    this._objectPool.deleteById(message.objectId);
  }

  public serializeValue(value: any, clientToken: ClientToken): SerializedValue {
    if (isPrimitiveValue(value)) {
      return {
        value,
      };
    }

    const objectInfo = this.trackInternal(value as any)!;
    const typeId = objectInfo.serializer.getTypeId(clientToken);
    if (typeId === undefined || typeId === null) {
      return undefined;
    }

    return { objectId: objectInfo.objectId, typeId };
  }

  public deserializeValue(value: SerializedValue, clientToken: ClientToken) {
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

  /**
   * Applies messages from multiple clients asynchronously.
   * That means that serializers can return promises which allows the feature to wait for method execution results for syncObject decorator targets.
   * Messages are applied in a certain order:
   * - First all create messages are applied in the order they are received, regardless of the client they come from.
   *   This is to ensure that all objects are created before any changes are applied to them.
   *   Some create messages may be used earlier than others if they are needed to create objects which are referenced by other messages,
   *   but there is no guaranteed order between independent create messages.
   * - Then change messages are applied in the order they are received.
   * - Then execute messages are applied in the order they are received.
   *
   * @param messagesByClient A map of client connections to messages.
   */
  public async applyMessagesAsync(messagesByClient: Map<ClientToken, Message[]>): Promise<void>;

  /**
   * Applies messages from a client connection.
   * @param messages The messages to apply.
   * @param clientToken The client connection the messages are from.
   */
  public async applyMessagesAsync(messages: Message[], clientToken: ClientToken): Promise<void>;

  public async applyMessagesAsync(messagesOrMessagesByClient: Message[] | Map<ClientToken, Message[]>, clientToken?: ClientToken): Promise<void> {
    if (messagesOrMessagesByClient instanceof Map) {
      for (const [clientToken, messages] of messagesOrMessagesByClient) {
        await this.applyMessagesAsync(messages, clientToken);
      }
      return;
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
    // First process all creation messages
    while (this._pendingCreateMessageByObjectId.size > 0) {
      const creationMessage = this._pendingCreateMessageByObjectId.values().next().value!;
      this.handleCreateMessage(creationMessage, clientToken!);
    }

    // Process all other messages
    for (const message of messages) {
      if (isDeleteObjectMessage(message)) await this.handleDeleteMessage(message as DeleteObjectMessage, clientToken!);
      else await this.handleOtherMessage(message, clientToken!);
    }
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
      info.serializer.clearStates();
    });

    this._objectPool.orphanedObjectInfos(this._ownClientToken).forEach((info) => {
      if (this._objectsWithPendingMessages.has(info.instance!)) return;
      this._objectPool.deleteByObject(info.instance!);
    });

    this._objectsWithPendingMessages.clear();
    this._pendingWeakDeletes.length = 0;
  }

  /**
   * Gets all messages to be sent to clients.
   * Will also reset internal tracking states.
   * @returns A map of client connections to messages.
   */
  getMessages(): Map<ClientToken, Message[]>;

  /**
   * Gets all messages to be sent to clients.
   * Will also reset internal tracking states when clearNonClientStates is true.
   * @param clearNonClientStates Whether to advance the internal state of the tracker after gathering messages. Defaults to true.
   * @returns A map of client connections to messages.
   */
  getMessages(clearNonClientStates: boolean): Map<ClientToken, Message[]>;

  /**
   * Gets all messages to be sent to a single client.
   * Will also reset internal tracking states.
   * @param clientToken The client connection to get messages for.
   * @returns The messages for the specified client.
   */
  getMessages(clientToken: ClientToken): Message[];

  /**
   * Gets all messages to be sent to a single client.
   * Will also reset internal tracking states when clearNonClientStates is true.
   * @param clientToken The client connection to get messages for.
   * @param clearNonClientStates Whether to advance the internal state of the tracker after gathering messages. Defaults to true.
   * @returns The messages for the specified client.
   */
  getMessages(clientToken: ClientToken, clearNonClientStates: boolean): Message[];

  /**
   * Gets all messages to be sent to multiple clients.
   * Will also reset internal tracking states.
   * @param clientTokens The client connections to get messages for.
   * @returns A map of client connections to messages.
   */
  getMessages(clientTokens: ClientToken[]): Map<ClientToken, Message[]>;

  /**
   * Gets all messages to be sent to multiple clients.
   * Will also reset internal tracking states when clearNonClientStates is true.
   * @param clientTokens The client connections to get messages for.
   * @param clearNonClientStates Whether to advance the internal state of the tracker after gathering messages. Defaults to true.
   * @returns A map of client connections to messages.
   */
  getMessages(clientTokens: ClientToken[], clearNonClientStates: boolean): Map<ClientToken, Message[]>;

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
      const serializersWhichsStatesNeedsToBeCleared: Set<TypeSerializer<any>> = new Set();

      for (const instance of this._objectsWithPendingMessages) {
        const objectInfo = this.trackInternal(instance)!;
        if (!objectInfo.isForClientToken(clientToken)) continue;
        serializersWhichsStatesNeedsToBeCleared.add(objectInfo.serializer);

        const isNewInstance = objectInfo.serializer.clients.has(clientToken) === false;
        if (isNewInstance) {
          objectInfo.serializer.clients.add(clientToken);
        }
        const messages = objectInfo.serializer.generateMessages(clientToken, isNewInstance);
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
            objectInfo.serializer.onClientRemoved(clientToken);
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

  /**
   * Finds a tracked object by its object ID.
   * @param objectId Object ID to find a specific object.
   * @returns The found object, or undefined if not found.
   */
  findOne<T extends object>(objectId: string): T | undefined;

  /**
   * Finds a tracked object by its constructor and optional object ID.
   * @param constructor The constructor of the object type to find.
   * @param objectId Optional object ID to find a specific object.
   * @returns The found object, or undefined if not found.
   */
  findOne<T extends object>(constructor: Constructor<T>, objectId?: string): T | undefined;

  findOne<T extends object>(constructorOrObjectId: Constructor<T> | string, objectId?: string) {
    if (typeof constructorOrObjectId === "string") {
      return this._objectPool.getObjectById(constructorOrObjectId) as T | undefined;
    }
    return this._objectPool.findOne(constructorOrObjectId, objectId);
  }

  /**
   * Finds all tracked objects of a specific type.
   * @param constructor The constructor of the object type to find.
   * @returns An array of found objects.
   */
  findAll<T extends object>(constructor: Constructor<T>) {
    return this._objectPool.findAll(constructor);
  }

  /**
   * Exchanges messages with clients by sending messages and receiving client messages.
   * @param settings Settings for exchanging messages.
   */
  async exchangeMessagesAsync(settings: ExchangeMessagesSettings): Promise<void> {
    const messages = settings.clients ? this.getMessages(settings.clients) : this.getMessages();

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
  getDispatcher<TDispatcher = null, TInstance extends object = any>(instance: TInstance): DispatcherOrFallback<TDispatcher, typeof instance> | null {
    const info = this._objectPool.getInfoByObject(instance as any);
    if (!info) throw new Error("Object is not tracked");

    const dispatcher = info.serializer.dispatcher;
    if (!dispatcher) {
      return null;
    }
    return dispatcher as DispatcherOrFallback<TDispatcher, typeof instance>;
  }
}

function getTypeSerializerClass(possibleSerializer: Constructor | TypeSerializerConstructor): TypeSerializerConstructor {
  if ("canSerialize" in possibleSerializer) {
    return possibleSerializer;
  }
  if (getSerializerSymbol in possibleSerializer) {
    return (possibleSerializer as any)[getSerializerSymbol]() as TypeSerializerConstructor;
  }
  const typeInfo = getTrackableTypeInfo(possibleSerializer);
  if (!typeInfo) {
    throw new Error(
      `Type '${possibleSerializer.name}' is not registered as a trackable type and not a TypeSerializer. Either decorate it with @syncObject, ensure that the type is a TypeSerializer or add the getSerializer symbol which returns the TypeSerializer for the provided type.`,
    );
  }

  return getSyncObjectSerializer(possibleSerializer);
}
