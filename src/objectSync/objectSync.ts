import { Message, ClientToken, ClientConnectionSettings, OneOrMany, IEventEmitter } from "../shared/index.js";
import { ISyncAgent } from "../syncAgents/index.js";
import { ExchangeMessagesSettings, ObjectSyncSettings } from "./types.js";
import { ObjectSyncCore, ObjectSyncEventMap, SyncAgentOrFallback, TrackedObjectDisposable } from "./objectSyncCore.js";

export class ObjectSync implements IEventEmitter<ObjectSyncEventMap> {
  private readonly _core: ObjectSyncCore;

  constructor(settings: ObjectSyncSettings) {
    this._core = new ObjectSyncCore(settings);
  }

  on<Event extends keyof ObjectSyncEventMap>(event: Event, callback: ObjectSyncEventMap[Event]): void {
    this._core.on(event, callback);
  }

  once<Event extends keyof ObjectSyncEventMap>(event: Event, callback: ObjectSyncEventMap[Event]): void {
    this._core.once(event, callback);
  }

  off<Event extends keyof ObjectSyncEventMap>(event: Event, callback: ObjectSyncEventMap[Event]): void {
    this._core.off(event, callback);
  }

  listenerCount<Event extends keyof ObjectSyncEventMap>(event: Event, callback?: ObjectSyncEventMap[Event] | undefined): number {
    return this._core.listenerCount(event, callback);
  }

  /**
   * Gets a view of all tracked objects. This includes all objects which are currently tracked, including root objects and objects which are only used by clients but not explicitly tracked.
   */
  get allObjects() {
    return this._core.allObjects;
  }

  /**
   * Gets a view of all tracked root objects. Root objects are objects which are explicitly tracked and will never be automatically deleted.
   */
  get rootObjects() {
    return this._core.rootObjects;
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
    return this._core.registerClient(settingsOrIdentity);
  }
  /**
   * Removes all client-specific state for a client (e.g., when disconnecting).
   */
  unregisterClient(clientToken: ClientToken): void {
    this._core.unregisterClient(clientToken);
  }

  /**
   * Gets the identity of this ObjectSync instance.
   */
  get identity() {
    return this._core.identity;
  }
  /**
   * Tracks an object for synchronization.
   * Must be called for root objects you want to track. Tracked root objects will never be automatically deleted.
   * @param instance The instance to track.
   * @param objectId Optional object ID to use for the tracked object. If not provided, a new object ID will be generated.
   * @return A disposable which can be used to untrack the object and access the tracked object's ID and instance (when still tracked).
   */
  track<T extends object>(instance: T, objectId?: string): TrackedObjectDisposable<T> {
    return this._core.track(instance, objectId);
  }

  /**
   * Untracks an object from synchronization.
   * Untracked objects are no longer prevented from being deleted and will be removed from clients when they are no longer used by them.
   * @param instance The instance to untrack.
   * @return True if the instance was untracked, false if it was not being tracked as a root object.
   */
  untrack(instance: object): boolean {
    return this._core.untrack(instance);
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
  public applyMessagesAsync(messagesByClient: Map<ClientToken, Message[]>): Promise<void>;

  /**
   * Applies messages from a client connection.
   * @param messages The messages to apply.
   * @param clientToken The client connection the messages are from.
   */
  public applyMessagesAsync(messages: Message[], clientToken: ClientToken): Promise<void>;

  public applyMessagesAsync(messagesOrMessagesByClient: Message[] | Map<ClientToken, Message[]>, clientToken?: ClientToken): Promise<void> {
    return this._core.applyMessagesAsync(messagesOrMessagesByClient, clientToken);
  }

  /**
   * Applies messages from multiple clients synchronously.
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
  public applyMessages(messagesByClient: Map<ClientToken, Message[]>): Promise<any>[];

  /**
   * Applies messages from a client connection.
   * @param messages The messages to apply.
   * @param clientToken The client connection the messages are from.
   */
  public applyMessages(messages: Message[], clientToken: ClientToken): Promise<any>[];

  public applyMessages(messagesOrMessagesByClient: Message[] | Map<ClientToken, Message[]>, clientToken?: ClientToken): Promise<any>[] {
    return this._core.applyMessages(messagesOrMessagesByClient, clientToken);
  }

  /**
   * Clears internal states, which are needed to store changes between synchronization cycles. Should be called after messages have been collected for all clients.
   */
  public clearStates() {
    this._core.clearStates();
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
    return this._core.getMessages(clientOrClientsOrCallTick, clearNonClientStates);
  }

  /**
   * Exchanges messages with clients by sending messages and receiving client messages.
   * @param settings Settings for exchanging messages.
   */
  exchangeMessagesAsync(settings: ExchangeMessagesSettings): Promise<void> {
    return this._core.exchangeMessagesAsync(settings);
  }

  /**
   * Gets the dispatcher associated with a tracked object instance.
   * A dispatcher is different for each kind of object and returned by its associated serializer.
   * USe this to configure ninstance based serializer settings.
   * @param instance The tracked object instance.
   * @returns The dispatcher associated with the object instance, or null if none exists.
   */
  getSyncAgent<TDispatcher extends ISyncAgent | null = null, TInstance extends object = any>(instance: TInstance): SyncAgentOrFallback<TDispatcher, typeof instance> {
    return this._core.getSyncAgent(instance);
  }
}
