import { type ClientConnection, type ClientConnectionSettings, ObjectChangeTracker, type TrackSettings } from "../tracker/tracker.js";
import { allTypeGenerators, ObjectChangeApplicator, type TypeGenerator, type TypeSerializer } from "../applicator/applicator.js";
import type { Message, MethodExecuteResult } from "../shared/messages.js";
import { TrackedObjectPool } from "../shared/trackedObjectPool.js";
import type { Constructor } from "../shared/types.js";
import { getTrackableTypeInfo } from "../tracker/decorators.js";
import type { ClientFilter } from "../index.js";

export type ObjectSyncSettings = {
  /**
   * Prefix for generated object IDs. When not provided, a default prefix based on identity and timestamp will be used.
   */
  objectIdPrefix?: string;
  /**
   * Identity of this ObjectSync instance (e.g., "host" or "client1").
   */
  identity: string;
  /**
   * Type generators to use for creating objects during synchronization.
   * Can be provided as a Map of type IDs to generators or as an array of constructor functions.
   * If not provided, all globally registered type generators will be used.
   */
  typeGenerators?: Map<string, TypeGenerator> | Constructor[];
  /**
   * Type serializers to use for serializing and deserializing property values during synchronization.
   * Can be provided as a Map of type IDs to serializers or as an array of serializers.
   */
  typeSerializers?: Map<string, TypeSerializer<any>> | TypeSerializer<any>[];
};

type FinalObjectSyncSettings = {
  objectIdPrefix: string;
  identity: string;
  typeGenerators: Map<string, TypeGenerator>;
  typeSerializers: Map<string, TypeSerializer<any>>;
};

/**
 * Main class for synchronizing objects between a host and clients.
 */
export class ObjectSync {
  private readonly _tracker: ObjectChangeTracker;
  private readonly _applicator: ObjectChangeApplicator;
  private readonly _settings: FinalObjectSyncSettings;

  constructor(settings: ObjectSyncSettings) {
    this._settings = {
      identity: settings.identity,
      objectIdPrefix: settings.objectIdPrefix ?? `${settings.identity}-${Date.now()}-`,
      typeGenerators: new Map<string, TypeGenerator>(),
      typeSerializers: new Map<string, TypeSerializer<any>>(),
    };

    if (Array.isArray(settings.typeGenerators)) {
      for (const constructor of settings.typeGenerators) {
        const trackableTypeInfo = getTrackableTypeInfo(constructor);
        this._settings.typeGenerators.set(trackableTypeInfo?.typeId ?? constructor.name, constructor);
      }
    } else if (settings.typeGenerators) this._settings.typeGenerators = settings.typeGenerators;
    else this._settings.typeGenerators = new Map(allTypeGenerators);

    if (Array.isArray(settings.typeSerializers)) {
      for (const serializer of settings.typeSerializers) {
        this._settings.typeSerializers.set(serializer.typeId ?? serializer.type.name, serializer);
      }
    } else if (settings.typeSerializers) this._settings.typeSerializers = settings.typeSerializers;

    const objectPool = new TrackedObjectPool();

    this._tracker = new ObjectChangeTracker({
      objectPool,
      ...this._settings,
    });
    this._applicator = new ObjectChangeApplicator({
      objectPool,
      ...this._settings,
    });
  }

  // get tracker(): ObjectChangeTracker {
  //   return this._tracker;
  // }

  // get applicator(): ObjectChangeApplicator {
  //   return this._applicator;
  // }

  /**
   * Gets all messages to be sent to clients. Will also reset internal tracking states.
   * @returns A map of client connections to messages.
   */
  getMessages(): Map<ClientConnection, Message[]> {
    return this._tracker.getMessages();
  }

  /**
   * Applies messages from a client connection.
   * @param messages The messages to apply.
   * @param clientConnection The client connection the messages are from.
   * @returns The results of method executions.
   */
  applyAsync(messages: Message<any>[], clientConnection: ClientConnection) {
    return this._applicator.applyAsync(messages, clientConnection);
  }

  /**
   * Applies method invoke results from clients to update tracked object invoke call states.
   * @param resultsByClient A map of client connections to method invoke results.
   */
  applyClientMethodInvokeResults(resultsByClient: Map<ClientConnection, MethodExecuteResult[]>): void {
    for (const [clientToken, results] of resultsByClient) {
      this._tracker.applyClientMethodInvokeResults(clientToken, results);
    }
  }

  /**
   * Applies messages from multiple clients.
   * @param messagesByClient A map of client connections to messages.
   * @returns A map of client connections to method execution results.
   */
  async applyMessagesAsync(messagesByClient: Map<ClientConnection, Message[]>): Promise<Map<ClientConnection, MethodExecuteResult[]>> {
    const resultsByClient = new Map<ClientConnection, MethodExecuteResult[]>();
    for (const [clientToken, messages] of messagesByClient) {
      const results = await this._applicator.applyAsync(messages, clientToken);
      resultsByClient.set(clientToken, results.methodExecuteResults);
      for (const obj of results.newTrackedObjects) {
        this._tracker.track(obj, {
          knownClients: clientToken,
        });
      }
    }
    return resultsByClient;
  }

  /**
   * Applies messages from a single client.
   * @param clientConnection The client connection the messages are from.
   * @param messages The messages to apply.
   * @returns The results of method executions.
   */
  async applyMessagesFromClientAsync(clientConnection: ClientConnection, messages: Message[]): Promise<MethodExecuteResult[]> {
    const results = await this._applicator.applyAsync(messages, clientConnection);
    for (const obj of results.newTrackedObjects) {
      this._tracker.track(obj, {
        knownClients: clientConnection,
      });
    }
    return results.methodExecuteResults;
  }

  /**
   * Exchanges messages with clients by sending messages and receiving method invoke results.
   * @param sendToClientAsync Function to send messages to a client and receive method invoke results.
   * @param errorHandler Optional function to handle errors.
   */
  async exchangeMessagesAsync(
    sendToClientAsync: (client: ClientConnection, messages: Message[]) => Promise<MethodExecuteResult[]>,
    errorHandler?: (client: ClientConnection, error: any) => void
  ): Promise<void> {
    const messages = this.getMessages();
    const resultsByClient = new Map<ClientConnection, Promise<MethodExecuteResult[]>>();
    const allPromises: Promise<MethodExecuteResult[]>[] = [];

    for (const [clientToken, clientMessages] of messages) {
      const methodInvokeResults = sendToClientAsync(clientToken, clientMessages);
      allPromises.push(methodInvokeResults);
      resultsByClient.set(clientToken, methodInvokeResults);
    }

    await Promise.allSettled(allPromises);

    for (const [clientToken, resultsPromise] of resultsByClient) {
      try {
        const results = await resultsPromise;
        this._tracker.applyClientMethodInvokeResults(clientToken, results);
      } catch (error) {
        if (errorHandler) {
          errorHandler(clientToken, error);
        }
      }
    }
  }

  /**
   * Exchanges messages in bulk with clients by sending messages and receiving method invoke results.
   * @param sendToClientsAsync Function to send messages to clients and receive method invoke results.
   * @param errorHandler Optional function to handle errors.
   */
  async exchangeMessagesBulkAsync(
    sendToClientsAsync: (messagesByClient: Map<ClientConnection, Message[]>) => Promise<Map<ClientConnection, MethodExecuteResult[]>>,
    errorHandler?: (client: ClientConnection, error: any) => void
  ): Promise<void> {
    const messages = this.getMessages();
    const resultsByClient = await sendToClientsAsync(messages);

    for (const [clientToken, resultsPromise] of resultsByClient) {
      try {
        const results = await resultsPromise;
        this._tracker.applyClientMethodInvokeResults(clientToken, results);
      } catch (error) {
        if (errorHandler) {
          errorHandler(clientToken, error);
        }
      }
    }
  }

  /**
   * Registers a type serializer.
   * @param serializer The type serializer to register.
   */
  registerSerializer(serializer: TypeSerializer<any> & { typeId: string }): void {
    this._tracker.registerSerializer(serializer);
  }

  /**
   * Gets the identity of this ObjectSync instance.
   */
  get identity() {
    return this._settings.identity;
  }

  /** Returns all currently tracked objects. */
  get allTrackedObjects() {
    return this._tracker.allTrackedObjects;
  }

  /**
   * Registers a new client connection.
   * @param settings Settings for the client connection.
   * @returns The registered client connection.
   */
  registerClient(settings: ClientConnectionSettings) {
    return this._tracker.registerClient(settings);
  }

  /**
   * Removes all client-specific state for a client (e.g., when disconnecting).
   */
  removeClient(client: ClientConnection): void {
    this._tracker.removeClient(client);
  }

  /**
   * Begins tracking an object, optionally with settings for object ID and client visibility.
   * Throws if objectId is specified for an already-trackable object.
   */
  track<T extends object>(target: T, trackSettings?: TrackSettings): void {
    this._tracker.track(target, trackSettings);
  }

  /**
   * Stops tracking an object.
   * @param target The target object to untrack.
   */
  untrack<T extends object>(target: T): void {
    this._tracker.untrack(target);
  }

  /**
   * Sets a client restriction filter for a tracked object.
   * @param obj The tracked object to set the filter for.
   * @param filter The client restriction filter to apply.
   */
  setClientRestriction<T extends object>(obj: T, filter: ClientFilter): void {
    this._tracker.setClientRestriction(obj, filter);
  }

  /**
   * Registers a type generator.
   * @param typeId The type ID the generator is for.
   * @param generator The type generator to register.
   */
  registerGenerator(typeId: string, generator: TypeGenerator): void {
    this._applicator.registerGenerator(typeId, generator);
  }

  /**
   * Finds a tracked object by its constructor and optional object ID.
   * @param constructor The constructor of the object type to find.
   * @param objectId Optional object ID to find a specific object.
   * @returns The found object, or undefined if not found.
   */
  findObjectOfType<T extends object>(constructor: Constructor<T>, objectId?: unknown) {
    return this._applicator.findObjectOfType(constructor, objectId);
  }

  /**
   * Finds all tracked objects of a specific type.
   * @param constructor The constructor of the object type to find.
   * @returns An array of found objects.
   */
  findObjectsOfType<T extends object>(constructor: Constructor<T>) {
    return this._applicator.findObjectsOfType(constructor);
  }
}
