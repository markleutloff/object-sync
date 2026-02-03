import { allSyncObjectTypes } from "../decorators/syncObject.js";
import { CreateObjectMessage, DeleteObjectMessage, isCreateObjectMessage, isDeleteObjectMessage, Message } from "../shared/messages.js";
import { ObjectInfo } from "../shared/objectInfo.js";
import { ObjectPool } from "../shared/objectPool.js";
import { Constructor, forEachIterable, isIterable, isPrimitiveValue, OneOrMany } from "../shared/types.js";
import { ClientToken, ClientConnectionSettings } from "../shared/clientToken.js";
import { defaultIntrinsicSerializers } from "../serialization/serializers/base.js";
import { getSyncObjectSerializer, ISyncObjectDispatcher, SyncObjectSerializer } from "../serialization/serializers/syncObject/index.js";
import { TypeSerializer, TypeSerializerConstructor } from "../serialization/serializer.js";
import { ClientTokenFilter } from "./clientFilter.js";
import { ObjectReference } from "./objectReference.js";
import { ISyncArrayDispatcher } from "../serialization/serializers/syncArray/serializer.js";
import { PrimitiveValue } from "./primitiveValue.js";

export type ExchangeMessagesSettings = {
  /**
   * Optional function to handle errors that occur during message exchange.
   * @param clientToken The client connection where the error occurred.
   * @param error The error that occurred.
   */
  errorHandler?: (clientToken: ClientToken, error: any) => void;

  /**
   * Optional function to filter messages sent to or received from clients.
   * Warning: Using this filter may lead to inconsistent states between server and clients if messages are blocked.
   * You can use it to implement custom logic, such as ignoring certain messages for specific clients.
   * @param clientToken The client connection involved in the message exchange.
   * @param message The message being sent or received.
   * @param isIncoming True if the message is incoming to the server, false if outgoing.
   * @returns True to allow the message, false to block it.
   */
  clientMessageFilter?: (clientToken: ClientToken, message: Message, isIncoming: boolean) => boolean;

  /**
   * Clients to exchange messages with. If not provided, messages will be exchanged with all registered clients.
   */
  clients?: ClientToken[];
} & (
  | {
      /**
       * Function to send messages to a single client and receive client messages back as results.
       * @param clientToken The client connection to send messages to.
       * @param messages The messages to send to the client.
       * @returns A promise that resolves to the messages received from the client.
       */
      sendToClientAsync: (clientToken: ClientToken, messages: Message[]) => Promise<Message[]>;
    }
  | {
      /**
       * Function to send messages to multiple clients and receive client messages back as results.
       * @param messagesByClientToken A map of client connections to messages to send.
       * @returns A promise that resolves to a map of client connections to messages received from the clients.
       */
      sendToClientsAsync: (messagesByClientToken: Map<ClientToken, Message[]>) => Promise<Map<ClientToken, Message[]>>;
    }
);

export type ObjectIdGeneratorSettings =
  | {
      /**
       * Function to generate an object ID..
       * @param value
       */
      generateId(value?: object): string;
    }
  | {
      /**
       * Prefix to use for generated object IDs.
       */
      prefix: string;
    };

export type FinalizedObjectSyncSettings = {
  identity: string;
  serializers: TypeSerializerConstructor[];
  intrinsicSerializers: TypeSerializerConstructor[];
  objectIdGeneratorSettings: ObjectIdGeneratorSettings;
  arrayChangeSetMode: "trackSplices" | "compareStates";
};

export type ObjectSyncSettings = {
  /**
   * Identity of this ObjectSync instance (e.g., "host" or "client1").
   */
  identity: string;
  /**
   * Type serializers to use for serializing and deserializing property values during synchronization.
   * Can either be provided as an array of type serializers or constructors of SyncObject types.
   * When constructors are provided, the corresponding internal SyncObjectSerializer will be used.
   * When not provided, all registered SyncObject types will be used.
   */
  serializers?: (TypeSerializerConstructor | Constructor)[];
  /**
   * Intrinsic type serializers to use for serializing and deserializing base types (Array, Map, Set, Object) during synchronization.
   * Can be provided as an array of type serializers.
   * When not provided, default intrinsic type serializers will be used.
   */
  intrinsicSerializers?: TypeSerializerConstructor[];
  /**
   * Settings for generating object IDs.
   * When not provided, a default generator with the identity as prefix will be used (eg: "host-1").
   */
  objectIdGeneratorSettings?: ObjectIdGeneratorSettings;

  /**
   * Defines how array changes are tracked and serialized.
   * - "trackSplices": Uses splice instructions to record changes. More efficient for small changes. May transfer data which will be removed with a later splice.
   * - "compareStates": gathers splice data by comparing the old array state to the new array state. More efficient for large changes. (Default)
   */
  arrayChangeSetMode?: "trackSplices" | "compareStates";
};

export class ObjectSync {
  private readonly _objectPool = new ObjectPool();
  private readonly _objectsWithPendingMessages = new Set<object>();
  private readonly _clients: Set<ClientToken> = new Set();
  private readonly _settings: FinalizedObjectSyncSettings;
  private _nextObjectId = 1;

  private _pendingCreateMessageByObjectId: Map<string, CreateObjectMessage> = new Map();
  private readonly _ownClientConnection: ClientToken;

  constructor(settings: ObjectSyncSettings) {
    this._settings = {
      identity: settings.identity,
      serializers: (settings.serializers ?? Array.from(allSyncObjectTypes)).map((ctor) => {
        if ("canSerialize" in ctor) return ctor as TypeSerializerConstructor;
        return getSyncObjectSerializer(ctor);
      }),
      intrinsicSerializers: settings.intrinsicSerializers ?? defaultIntrinsicSerializers,
      objectIdGeneratorSettings: settings.objectIdGeneratorSettings ?? {
        prefix: settings.identity,
      },
      arrayChangeSetMode: settings.arrayChangeSetMode ?? "compareStates",
    };

    this._ownClientConnection = this.registerClient({ identity: settings.identity });
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
   * @param settings Settings for the client connection.
   * @returns The token to the newly registered client connection.
   */
  registerClient(settings: ClientConnectionSettings): ClientToken {
    const clientToken = JSON.parse(JSON.stringify(settings));
    this._clients.add(clientToken);
    return clientToken;
  }

  get registeredClientTokens() {
    return Array.from(this._clients).filter((c) => c !== this._ownClientConnection);
  }

  /**
   * Removes all client-specific state for a client (e.g., when disconnecting).
   */
  removeClient(clientToken: ClientToken): void {
    if (!this._clients.has(clientToken)) {
      throw new Error("Unknown client token");
    }

    this._objectPool.infos.forEach((info) => {
      info.serializer.onClientConnectionRemoved(clientToken);
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
   * Must be called for root objects you want to track.
   * TypeSerializers must call this with non-root objects they encounter.
   * @param instance The instance to track.
   */
  track(instance: object, objectId?: string): void {
    const info = this.trackInternal(instance, objectId);
    if (!info) {
      throw new Error("Cannot track primitive value as root.");
    }
    info.isRoot = true;
    info.serializer.clients.add(this._ownClientConnection);
  }

  trackInternal(instance: object, objectId?: string): ObjectInfo | null {
    if (isPrimitiveValue(instance)) return null;
    let info = this._objectPool.getInfoByObject(instance);
    if (info) {
      return info;
    }

    if (objectId !== undefined) {
      info = this._objectPool.getInfoById(objectId!);
      if (info) {
        this._objectPool.onObjectSet(info);
        return info;
      }
    }

    info = new ObjectInfo(this, objectId, instance);
    info.isOwned = true;
    this._objectPool.add(info);
    info.initializeSerializer(instance);

    return info;
  }

  /**
   * Untracks an object from synchronization.
   * A delete message will be sent to clients during the next message generation, after which the object will be fully removed.
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

  private async handleOtherMessage(message: Message, clientToken: ClientToken) {
    const info = this._objectPool.getInfoById(message.objectId);
    if (!info) return;

    await info.serializer.applyMessage(message, clientToken);
  }

  private async handleDeleteMessage(message: DeleteObjectMessage, clientToken: ClientToken) {
    const info = this._objectPool.getInfoById(message.objectId);
    if (!info) return;

    await info.serializer.applyMessage(message, clientToken);
    this._objectPool.deleteById(message.objectId);
  }

  public serializeValue(value: any, clientToken: ClientToken): PrimitiveValue | ObjectReference | undefined {
    if (isPrimitiveValue(value)) {
      return new PrimitiveValue(value);
    }

    return ObjectReference.from(this.trackInternal(value as any)!, clientToken);
  }

  public deserializeValue(value: PrimitiveValue | ObjectReference | undefined, clientToken: ClientToken) {
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
   * Applies messages from multiple clients.
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

    messages.sort((a, b) => {
      if (a.type === b.type) return 0;
      if (a.type === "create") return -1;
      if (b.type === "create") return 1;
      if (a.type === "change") return -1;
      if (b.type === "change") return 1;
      if (a.type === "execute") return -1;
      if (b.type === "execute") return 1;
      if (a.type === "delete") return 1;
      if (b.type === "delete") return -1;
      return 0;
    });

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

  /**
   * Clears internal states, which are needed to store changes between synchronization cycles. Should be called after messages have been collected for all clients.
   */
  public clearStates() {
    this._objectPool.infos.forEach((info) => {
      info.serializer.clearStates();
    });
    this._objectsWithPendingMessages.clear();

    this._objectPool.orphanedObjectInfos(this._ownClientConnection).forEach((info) => {
      this._objectPool.deleteByObject(info.instance!);
    });
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
      if (clientToken === this._ownClientConnection) return;

      const generatedMessages: Message[] = [];
      const serializersWhichsStatesNeedsToBeCleared: Set<TypeSerializer<any>> = new Set();

      for (const instance of this._objectsWithPendingMessages) {
        const objectInfo = this.trackInternal(instance)!; //this._objectPool.getInfoByObject(instance)!;
        if (!objectInfo.isForClientToken(clientToken)) continue;
        serializersWhichsStatesNeedsToBeCleared.add(objectInfo.serializer);

        const isNewInstance = objectInfo.serializer.clients.has(clientToken) === false;
        if (isNewInstance) {
          objectInfo.serializer.clients.add(clientToken);
        }
        const messages = objectInfo.serializer.generateMessages(clientToken, isNewInstance);
        generatedMessages.push(...messages);
      }

      for (const serializer of serializersWhichsStatesNeedsToBeCleared) {
        serializer.clearStates(clientToken);
      }

      while (true) {
        const noLongerTrackedByClient = this._objectPool.objectInfosToDelete(clientToken);
        if (noLongerTrackedByClient.length === 0) {
          break;
        }
        for (const objectInfo of noLongerTrackedByClient) {
          objectInfo.serializer.onClientConnectionRemoved(clientToken);
          generatedMessages.push({
            type: "delete",
            objectId: objectInfo.objectId,
          });
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

type DispatcherType<TInstance> = TInstance extends Array<infer TArrayItem> ? ISyncArrayDispatcher<TArrayItem> : TInstance extends object ? ISyncObjectDispatcher<TInstance> : never;

type DispatcherOrFallback<TDispatcher, TInstance> = TDispatcher extends null ? DispatcherType<TInstance> : TDispatcher;
