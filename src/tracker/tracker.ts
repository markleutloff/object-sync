import { TypeSerializer } from "../applicator/applicator.js";
import { ChangeObjectMessage, CreateObjectMessage, ExecuteObjectMessage, isPropertyInfo, Message, MethodExecuteResult, PropertyInfo, TrackedObjectPool } from "../shared/index.js";
import { NativeTypeSerializer } from "../shared/nativeTypeGenerators.js";
import { getTrackerObjectInfo } from "../shared/objectSyncMetaInfo.js";
import { Constructor, forEachIterable, OneOrMany } from "../shared/types.js";
import { ClientFilter, ChangeTrackerObjectInfo, ChangeTrackerObjectSyncMetaInfoCreateSettings } from "./trackerObjectInfo.js";

type GatherMessagesForObjectGraphArgs = {
  object: object;
  client: ClientConnection;
  objectsToVisit: Set<object>;
  messages: Message[];
};

export type TrackSettings = {
  /**
   * Optional unique identifier for the object; if not provided, one will be generated.
   */
  objectId?: unknown;

  /**
   * If true, the object is considered a root object. Defaults to true.
   */
  isRoot?: boolean;

  /**
   * Settings for restricting client visibility of the object.
   */
  clientVisibility?: ClientFilter;

  knownClients?: OneOrMany<ClientConnection>;
};

export type ObjectChangeTrackerSettings = {
  objectIdPrefix: string;
  objectPool: TrackedObjectPool;
  identity: string;
  typeSerializers: Map<string, TypeSerializer<any>>;
  nativeTypeSerializers: NativeTypeSerializer[];
};

type FinalObjectChangeTrackerSettings = {
  objectIdPrefix: string;
  identity: string;
};

/**
 * Settings for a client connection.
 */
export type ClientConnectionSettings = {
  /**
   * Identity of the client (e.g., "host", "client1", etc.).
   */
  identity: string;
};

/**
 * Representation of a connection to a client.
 */
export type ClientConnection = {
  /**
   * Identity of the client (e.g., "host", "client1", etc.).
   */
  identity: string;
};

/**
 * The ChangeTrackerHost manages the lifecycle and visibility of trackable objects on the host/server side.
 * It tracks which objects are visible to which clients, manages object creation/deletion, and generates messages for clients.
 */
export class ObjectChangeTracker {
  /** Pool of all currently tracked objects and their info. */
  private _trackedObjectPool: TrackedObjectPool;

  private _clients: Set<ClientConnectionSettings> = new Set();
  private _serializers: Map<Constructor, TypeSerializer<any> & { typeId: string }> = new Map<Constructor, TypeSerializer<any> & { typeId: string }>();
  private _nativeTypeSerializers: NativeTypeSerializer[] = [];

  private readonly _settings: FinalObjectChangeTrackerSettings;

  constructor(settings: ObjectChangeTrackerSettings) {
    this._settings = {
      identity: settings.identity,
      objectIdPrefix: settings.objectIdPrefix,
    };
    this._trackedObjectPool = settings.objectPool;

    settings.typeSerializers.forEach((gen, typeId) => {
      const serializer = gen as TypeSerializer<any> & { typeId: string };
      serializer.typeId = serializer.typeId ?? typeId;
      this.registerSerializer(serializer);
    });

    this._nativeTypeSerializers = settings.nativeTypeSerializers;
  }

  get settings(): FinalObjectChangeTrackerSettings {
    return this._settings;
  }

  registerSerializer(serializer: TypeSerializer<any> & { typeId: string }): void {
    if (this._serializers.has(serializer.type)) {
      throw new Error(`Serializer for typeId ${serializer.typeId} is already registered`);
    }
    this._serializers.set(serializer.type, serializer);
  }

  get identity() {
    return this._settings.identity;
  }

  /** Returns all currently tracked objects. */
  get allTrackedObjects() {
    return this._trackedObjectPool.all;
  }

  registerClient(settings: ClientConnectionSettings): ClientConnection {
    const clientToken = JSON.parse(JSON.stringify(settings));
    this._clients.add(clientToken);
    return clientToken;
  }

  /**
   * Removes all client-specific state for a client (e.g., when disconnecting).
   */
  removeClient(client: ClientConnection): void {
    if (!this._clients.has(client)) {
      throw new Error("Unknown client token");
    }

    this._trackedObjectPool.all.forEach((obj) => {
      const hostObjectInfo = getTrackerObjectInfo(obj)!;
      hostObjectInfo.onClientRemoved(client);
    });

    this._clients.delete(client);
  }

  /**
   * Restricts the visibility of a tracked object to a set of clients.
   * @param obj The object to restrict.
   * @param clients The client(s) allowed or excluded.
   * @param isExclusive If true, only the given clients can see the object; otherwise, all except these clients can see it.
   */
  setClientRestriction<T extends object>(obj: T, filter: ClientFilter): void {
    const tracked = getTrackerObjectInfo(obj);
    if (!tracked) throw new Error("Object is not tracked");
    tracked.setClientRestriction(filter);
  }

  /**
   * Begins tracking an object, optionally with settings for object ID and client visibility.
   * Throws if objectId is specified for an already-trackable object.
   */
  track<T extends object>(target: T, trackSettings?: TrackSettings): void {
    this.trackInternal(target, trackSettings);
  }

  private trackInternal<T extends object>(target: T, trackSettings?: TrackSettings): ChangeTrackerObjectInfo<T> | null {
    if (!target) return null;

    const isRoot = trackSettings?.isRoot !== false;

    let hostObjectInfo: ChangeTrackerObjectInfo<T> | null = getTrackerObjectInfo(target);
    if (!hostObjectInfo) {
      const creationSettings: ChangeTrackerObjectSyncMetaInfoCreateSettings<T> = {
        objectId: trackSettings?.objectId,
        isRoot,
        object: target,
        objectIdPrefix: this._settings.objectIdPrefix!,
        owner: this,
      };

      hostObjectInfo = getTrackerObjectInfo(target) ?? ChangeTrackerObjectInfo.create<T>(creationSettings);
      if (!hostObjectInfo) return null;

      if (!this._trackedObjectPool.has(target)) this._trackedObjectPool.add(target);

      if (trackSettings?.clientVisibility) {
        this.setClientRestriction(target, trackSettings.clientVisibility);
      }
    } else {
      if (!this._trackedObjectPool.has(target)) this._trackedObjectPool.add(target);
    }

    if (trackSettings?.knownClients) {
      const clients = hostObjectInfo.clients;
      if (clients) {
        forEachIterable(trackSettings.knownClients, (client) => {
          clients.add(client);
        });
      }
    }

    return hostObjectInfo!;
  }

  /**
   * Stops tracking an object and queues delete messages for all clients that could see it.
   * If an object is passed instead of a TrackableObject, it will first be looked up.
   */
  untrack<T extends object>(target: T): void {
    this.untrackInternal(target, true);
  }

  private untrackInternal<T extends object>(target: T, throwWhenNotTracked: boolean) {
    const hostObjectInfo = getTrackerObjectInfo(target)!;
    if (!this._trackedObjectPool.has(target) || !hostObjectInfo) {
      if (throwWhenNotTracked) {
        throw new Error("Object is not tracked");
      }
      return false;
    }

    hostObjectInfo.isRootObject = false; // when the object is really not tracked it will be finally removed once the next tick happens

    return true;
  }

  getMessages(clientOrClients?: OneOrMany<ClientConnection>): Map<ClientConnection, Message[]> {
    clientOrClients ??= this._clients;

    const result = new Map<ClientConnection, Message[]>();
    forEachIterable(clientOrClients, (client) => {
      const initialTrackedObjects = this._trackedObjectPool.allMetaInfos.filter((o) => o.trackerInfo?.isRootObject).map((o) => o.object);
      const allTrackedObjectsForClient = this._trackedObjectPool.allMetaInfos.filter((o) => o.trackerInfo?.clients.has(client)).map((o) => o.object);
      const objectsToVisit: Set<object> = new Set([...initialTrackedObjects]);
      let messages: Message[] = [];

      for (const obj of objectsToVisit) {
        this.gatherMessagesForObjectGraph({
          object: obj,
          client,
          objectsToVisit,
          messages,
        });
      }

      const noLongerTrackedByClient = allTrackedObjectsForClient.filter((o) => {
        if (objectsToVisit.has(o)) return false;
        return true;
      });

      for (const obj of noLongerTrackedByClient) {
        const hostObjectInfo = getTrackerObjectInfo(obj);
        if (!hostObjectInfo) continue;
        hostObjectInfo.onClientRemoved(client);
        messages.push(hostObjectInfo.getDeleteMessage());
      }

      result.set(client, messages);
    });

    return result;
  }

  private gatherMessagesForObjectGraph(args: GatherMessagesForObjectGraphArgs) {
    const hostObjectInfo = getTrackerObjectInfo(args.object);
    if (!hostObjectInfo) return;
    if (!hostObjectInfo?.isForClient(args.client)) return;

    const isKnownToClient = hostObjectInfo.clients.has(args.client);
    const subMessages: Message[] = [];
    if (!isKnownToClient) {
      const createMessage = hostObjectInfo.getCreateMessage(args.client);
      if (createMessage !== null) {
        hostObjectInfo.clients.add(args.client);
        subMessages.push(createMessage);
      }
    } else {
      const updateMessage = hostObjectInfo.getChangeMessage(args.client);
      if (updateMessage !== null) {
        subMessages.push(updateMessage);
      }
    }

    const executeMessages = hostObjectInfo.getExecuteMessages(args.client) as ExecuteObjectMessage<object>[];
    subMessages.push(...executeMessages);
    args.messages.push(...subMessages);

    for (const message of subMessages) {
      this.gatherSubTrackablesForGraphFromMessage(message, args);
    }
  }

  private gatherSubTrackablesForGraphFromMessage(message: Message, args: GatherMessagesForObjectGraphArgs) {
    let valuesToScan: PropertyInfo<any, any>[] = [];
    if (message.type === "create" || message.type === "change") {
      const properties = (message as CreateObjectMessage<any> | ChangeObjectMessage<any>).properties;
      Object.values(properties).map((propertyInfo) => {
        if (propertyInfo) valuesToScan.push(propertyInfo);
      });
    } else if (message.type === "execute") {
      const parameters = (message as ExecuteObjectMessage<any>).parameters;
      Object.values(parameters).map((parameterInfo) => {
        if (parameterInfo) valuesToScan.push(parameterInfo);
      });
    }

    for (const propertyInfo of valuesToScan) {
      this.gatherSubTrackablesForGraphFromValue(propertyInfo, args);
      if (propertyInfo.objectId && propertyInfo.value) {
        args.objectsToVisit.add(propertyInfo.value);
        delete propertyInfo.value;
      }
    }
  }

  private gatherSubTrackablesForGraphFromValue(data: any, args: GatherMessagesForObjectGraphArgs, visitedValues: Set<any> = new Set()): void {
    if (data === undefined || data === null || typeof data !== "object" || visitedValues.has(data)) return;

    visitedValues.add(data);

    if (isPropertyInfo(data)) {
      const isTrackable = data.objectId && data.value !== undefined;
      const isUntrackableObjectOrArray = !isTrackable && data.value && typeof data.value === "object";
      if (isTrackable) {
        this.trackInternal(data.value, { isRoot: false });
        args.objectsToVisit.add(data.value);
        delete data.value; // remove the value as the objectId now points to it
      } else if (isUntrackableObjectOrArray) {
        this.gatherSubTrackablesForGraphFromValue(data.value, args, visitedValues);
      }
    } else if (Array.isArray(data)) {
      data.forEach((value) => {
        if (!value || typeof value !== "object") return;

        this.gatherSubTrackablesForGraphFromValue(value, args, visitedValues);
      });
    } else {
      Object.keys(data).forEach((key) => {
        const value = (data as any)[key];

        if (!value || typeof value !== "object") return;

        this.gatherSubTrackablesForGraphFromValue(value, args, visitedValues);
      });
    }
  }

  public applyClientMethodInvokeResults(client: ClientConnection, methodExecuteResults: MethodExecuteResult[]) {
    for (const result of methodExecuteResults) {
      const tracked = this._trackedObjectPool.get(result.objectId);
      if (!tracked) continue;
      const hostObjectInfo = getTrackerObjectInfo(tracked);
      hostObjectInfo?.onClientMethodExecuteResultReceived(result, client);
    }
  }

  tick(): void {
    this._trackedObjectPool.allMetaInfos.forEach((meta) => {
      const hostObjectInfo = meta.trackerInfo;
      if (!hostObjectInfo) return;

      // Finalize possible deleted tracked objects
      if (!hostObjectInfo.isRootObject && hostObjectInfo.clients.size === 0) {
        meta.trackerInfo?.onClientRemoved;
        this._trackedObjectPool.deleteById(meta.objectId);
        return;
      }

      // Everything else may advance its state
      hostObjectInfo.tick();
    });
  }

  serializeValue(value: object, trackerInfo: ChangeTrackerObjectInfo<any>): { value: any; typeId: string } | null {
    let serializer = this._serializers.get(value.constructor as Constructor) ?? this._nativeTypeSerializers.find((g) => value instanceof g.type);
    if (!serializer) {
      return null;
    }
    return {
      value: serializer.serialize
        ? serializer.serialize(value, trackerInfo)
        : "toJSON" in value && typeof value.toJSON === "function"
          ? value.toJSON()
          : "toValue" in value && typeof value.toValue === "function"
            ? value.toValue()
            : value,
      typeId: serializer.typeId,
    };
  }
}
