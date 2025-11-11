import { ClientConnection, ClientConnectionSettings, ObjectChangeTracker, TrackSettings } from "../tracker/tracker.js";
import { allTypeGenerators, ObjectChangeApplicator, TypeGenerator, TypeSerializer } from "../applicator/applicator.js";
import { Message, MethodExecuteResult } from "../shared/messages.js";
import { TrackedObjectPool } from "../shared/trackedObjectPool.js";
import { Constructor } from "../shared/types.js";
import { getTrackableTypeInfo } from "../tracker/decorators.js";

export type ObjectSyncSettings = {
  objectIdPrefix?: string;
  identity: string;
  typeGenerators?: Map<string, TypeGenerator> | Constructor[];
  typeSerializers?: Map<string, TypeSerializer<any>> | TypeSerializer<any>[];
};

type FinalObjectSyncSettings = {
  objectIdPrefix: string;
  identity: string;
  typeGenerators: Map<string, TypeGenerator>;
  typeSerializers: Map<string, TypeSerializer<any>>;
};

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

  getMessages(): Map<ClientConnection, Message[]> {
    return this._tracker.getMessages();
  }

  applyAsync(messages: Message<any>[], clientConnection: ClientConnection) {
    return this._applicator.applyAsync(messages, clientConnection);
  }

  applyClientMethodInvokeResults(resultsByClient: Map<ClientConnection, MethodExecuteResult[]>): void {
    for (const [clientToken, results] of resultsByClient) {
      this._tracker.applyClientMethodInvokeResults(clientToken, results);
    }
  }

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

  async applyMessagesFromClientAsync(clientConnection: ClientConnection, messages: Message[]): Promise<MethodExecuteResult[]> {
    const results = await this._applicator.applyAsync(messages, clientConnection);
    for (const obj of results.newTrackedObjects) {
      this._tracker.track(obj, {
        knownClients: clientConnection,
      });
    }
    return results.methodExecuteResults;
  }

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

  // shorthands for the tracker and applicator
  registerSerializer(serializer: TypeSerializer<any> & { typeId: string }): void {
    this._tracker.registerSerializer(serializer);
  }

  get identity() {
    return this._settings.identity;
  }

  /** Returns all currently tracked objects. */
  get allTrackedObjects() {
    return this._tracker.allTrackedObjects;
  }

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

  untrack<T extends object>(target: T): void {
    this._tracker.untrack(target);
  }

  //// Applicator shorthands
  registerGenerator(typeId: string, generator: TypeGenerator): void {
    this._applicator.registerGenerator(typeId, generator);
  }

  findObjectOfType<T extends object>(constructor: Constructor<T>, objectId?: unknown) {
    return this._applicator.findObjectOfType(constructor, objectId);
  }

  findObjectsOfType<T extends object>(constructor: Constructor<T>) {
    return this._applicator.findObjectsOfType(constructor);
  }
}
