import { ChangeObjectMessage, CreateObjectMessage, DeleteObjectMessage, ExecuteObjectMessage, isPropertyInfo, Message, PropertyInfo, TrackedObjectPool } from "../shared/index.js";
import { getHostObjectInfo } from "../shared/objectSyncMetaInfo.js";
import { forEachIterable, OneOrMany } from "../shared/types.js";
import { checkCanUseObject } from "./decorators.js";
import { ClientFilter, ClientSpecificView, HostObjectInfo, ServerObjectSyncMetaInfoCreateSettings } from "./hostObjectInfo.js";

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

  /**
   * If true, tracking an already tracked object will be ignored instead of throwing an error.
   * Defaults to false.
   */
  ignoreAlreadyTracked?: boolean;

  knownClients?: OneOrMany<ClientConnection>;
};

export type ObjectSyncHostSettings = {
  objectIdPrefix?: string;
  objectPool?: TrackedObjectPool;
  designation?: string;
};

export type ClientConnectionSettings = {
  designation?: string;
};

export type ClientConnection = ClientConnectionSettings;

/**
 * The ChangeTrackerHost manages the lifecycle and visibility of trackable objects on the host/server side.
 * It tracks which objects are visible to which clients, manages object creation/deletion, and generates messages for clients.
 */
export class ObjectSyncHost {
  /** Pool of all currently tracked objects and their info. */
  private _trackedObjectPool: TrackedObjectPool;
  /** Maps client IDs to lists of delete messages for objects that have been untracked. */
  private _untrackedObjectInfosByClient = new Map<ClientConnection, DeleteObjectMessage[]>();

  private _clients: Set<ClientConnectionSettings> = new Set();

  constructor(private readonly _settings: ObjectSyncHostSettings = {}) {
    if (!this._settings.objectIdPrefix) {
      this._settings.objectIdPrefix = `host-${Date.now()}-`;
    }
    this._trackedObjectPool = this._settings.objectPool ?? new TrackedObjectPool();
  }

  /** Returns all currently tracked objects. */
  get allTrackedObjects() {
    return this._trackedObjectPool.all;
  }

  registerClient(settings: ClientConnectionSettings = {}): ClientConnection {
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
      const hostObjectInfo = getHostObjectInfo(obj)!;
      hostObjectInfo.clients.delete(client);
    });
    this._untrackedObjectInfosByClient.delete(client);

    this._clients.delete(client);
  }

  /**
   * Restricts the visibility of a tracked object to a set of clients.
   * @param obj The object to restrict.
   * @param clients The client(s) allowed or excluded.
   * @param isExclusive If true, only the given clients can see the object; otherwise, all except these clients can see it.
   */
  setClientRestriction<T extends object>(obj: T, filter: ClientFilter): void {
    const tracked = getHostObjectInfo(obj);
    if (!tracked) throw new Error("Object is not tracked");
    tracked.setClientRestriction(filter);
  }

  /**
   * Adds a client-specific view to a tracked object.
   */
  addView<T extends object>(obj: T, view: ClientSpecificView<T>): void {
    const tracked = getHostObjectInfo(obj);
    if (!tracked) throw new Error("Object is not tracked");
    tracked.addView(view);
  }

  /**
   * Removes a client-specific view from a tracked object.
   * @returns true if the view was removed, false otherwise.
   */
  removeView<T extends object>(obj: T, view: ClientSpecificView<T>): boolean {
    const tracked = getHostObjectInfo(obj);
    if (!tracked) return false;
    return tracked.removeView(view);
  }

  /**
   * Begins tracking an object, optionally with settings for object ID and client visibility.
   * Throws if objectId is specified for an already-trackable object.
   */
  track<T extends object>(target: T, trackSettings?: TrackSettings): void {
    this.trackInternal(target, trackSettings);
  }

  private trackInternal<T extends object>(target: T, trackSettings?: TrackSettings): HostObjectInfo<T> | null {
    if (!target) return null;

    const isRoot = trackSettings?.isRoot !== false;

    if (this._trackedObjectPool.has(target) && getHostObjectInfo(target)) {
      if (isRoot && (trackSettings?.ignoreAlreadyTracked ?? false) === false) {
        throw new Error("Object is already tracked");
      }
      return null;
    }

    const creationSettings: ServerObjectSyncMetaInfoCreateSettings<T> = {
      objectId: trackSettings?.objectId,
      isRoot,
      object: target,
      objectIdPrefix: this._settings.objectIdPrefix!,
    };

    const hostObjectInfo: HostObjectInfo<T> | null = getHostObjectInfo(target) ?? HostObjectInfo.tryEnsureAutoTrackable<T>(creationSettings) ?? HostObjectInfo.createFromObject(creationSettings);

    if (!hostObjectInfo) return null;

    if (!this._trackedObjectPool.has(target)) this._trackedObjectPool.add(target);

    this._untrackedObjectInfosByClient.forEach((deleteMessages, client) => {
      let deleteMessageIndex = deleteMessages.findIndex((m) => m.objectId === hostObjectInfo.objectId);
      if (deleteMessageIndex === -1) return;
      deleteMessages.splice(deleteMessageIndex, 1);
      if (deleteMessages.length === 0) {
        this._untrackedObjectInfosByClient.delete(client);
      }
    });
    if (trackSettings?.clientVisibility) {
      this.setClientRestriction(target, trackSettings.clientVisibility);
    }

    if (trackSettings?.knownClients) {
      const clients = getHostObjectInfo(target)?.clients;
      if (clients) {
        forEachIterable(trackSettings.knownClients, (client) => {
          clients.add(client);
        });
      }
    }

    return hostObjectInfo;
  }

  /**
   * Stops tracking an object and queues delete messages for all clients that could see it.
   * If an object is passed instead of a TrackableObject, it will first be looked up.
   */
  untrack<T extends object>(target: T): void {
    if (this.untrackInternal(target, true)) this.removeUnusedObjects();
  }

  private untrackInternal<T extends object>(target: T, throwWhenNotTracked: boolean) {
    const hostObjectInfo = getHostObjectInfo(target)!;
    if (!this._trackedObjectPool.has(target) || !hostObjectInfo) {
      if (throwWhenNotTracked) {
        throw new Error("Object is not tracked");
      }
      return false;
    }

    this._trackedObjectPool.delete(target);
    const clients = Array.from(hostObjectInfo.clients);
    const deleteMessage = hostObjectInfo.getDeleteMessage();
    clients.forEach((client) => {
      let deleteMessages = this._untrackedObjectInfosByClient.get(client);
      if (!deleteMessages) {
        deleteMessages = [];
        this._untrackedObjectInfosByClient.set(client, deleteMessages);
      }
      deleteMessages.push(deleteMessage);
    });
    return true;
  }

  /**
   * For a given message, finds and tracks any nested objects referenced by objectId/value pairs.
   * Removes the value from the property after tracking.
   * @returns Array of HostTrackableObjectInfo for any new objects tracked.
   */
  private gatherUntrackedObjectInfos(data: ChangeObjectMessage<any> | CreateObjectMessage<any>) {
    return this.gatherUntrackedObjectInfosFromRaw(data.properties);
  }

  private gatherUntrackedObjectInfosFromRaw(data: object | Array<any>, tracked: Set<object> = new Set()): object[] {
    if (tracked.has(data)) {
      return [];
    }
    tracked.add(data);

    const result: object[] = [];

    if (isPropertyInfo(data)) {
      const propertyInfo = data as PropertyInfo<any, any>;
      if (propertyInfo.objectId && propertyInfo.value) {
        const newTrackable = this.trackInternal(propertyInfo.value, { isRoot: false });
        delete propertyInfo.value;
        if (newTrackable) {
          result.push(newTrackable.object);
        }
      }
    }

    if (Array.isArray(data)) {
      data.forEach((value) => {
        if (!value || typeof value !== "object") return;

        result.push(...this.gatherUntrackedObjectInfosFromRaw(value, tracked));
      });
      return result;
    }

    Object.keys(data).forEach((key) => {
      const value = (data as any)[key];

      if (!value || typeof value !== "object") return;

      if (!isPropertyInfo(value)) {
        result.push(...this.gatherUntrackedObjectInfosFromRaw(value, tracked));
        return;
      }

      const propertyInfo = value as PropertyInfo<any, any>;
      if (propertyInfo.objectId && propertyInfo.value) {
        const newTrackable = this.trackInternal(propertyInfo.value, { isRoot: false });
        delete propertyInfo.value;
        if (newTrackable) {
          result.push(newTrackable.object);
        }
      }

      if (propertyInfo.value && typeof propertyInfo.value === "object") {
        result.push(...this.gatherUntrackedObjectInfosFromRaw(propertyInfo.value, tracked));
      }
    });
    return result;
  }

  getMessages(tick: boolean = true): Map<ClientConnection, Message[]> {
    const result = new Map<ClientConnection, Message[]>();
    for (const client of this._clients) {
      result.set(client, this.getMessagesForClientInternal(client));
    }
    if (tick) this.tick();
    return result;
  }

  /**
   * Internal: Gathers all messages for a client.
   */
  private getMessagesForClientInternal(client: ClientConnection): Message[] {
    const messages: Message[] = [];
    let all = this._trackedObjectPool.all;
    let newTrackableObjects: object[] = [];
    while (all.length > 0) {
      newTrackableObjects = [];
      all.forEach((obj) => {
        this.getMessagesForTrackableObjectInfo(obj, client, messages, newTrackableObjects);
      });
      all = newTrackableObjects;
    }

    this._untrackedObjectInfosByClient.forEach((deleteMessages, c) => {
      if (c === client) {
        messages.push(...deleteMessages);
        this._untrackedObjectInfosByClient.delete(client);
      }
    });
    return messages;
  }

  /**
   * Internal: Adds create/change/execute messages for a tracked object to the outgoing message list for a client.
   * Also tracks any nested objects referenced in the message.
   */
  private getMessagesForTrackableObjectInfo(syncObject: object, client: ClientConnection, messages: Message[], newTrackableObjects: object[]): void {
    if (!checkCanUseObject(syncObject, client.designation)) return;
    if (!checkCanUseObject(syncObject, this._settings.designation)) return;

    const hostObjectInfo = getHostObjectInfo(syncObject);
    if (!hostObjectInfo?.isForClient(client)) return;

    const hasClient = hostObjectInfo.clients.has(client);
    let message: Message | null;
    if (!hasClient) {
      message = hostObjectInfo.getCreateMessage(client);
      if (message !== null) {
        hostObjectInfo.clients.add(client);
      }
    } else {
      message = hostObjectInfo.getChangeMessage(client);
    }
    if (message !== null) {
      newTrackableObjects.push(...this.gatherUntrackedObjectInfos(message));
      messages.push(message);
    }

    const executeMessages = hostObjectInfo.getExecuteMessages(client) as ExecuteObjectMessage<object>[];
    messages.push(...executeMessages);
  }

  private tick(): void {
    this._trackedObjectPool.all.forEach((obj) => {
      const hostObjectInfo = getHostObjectInfo(obj)!;
      hostObjectInfo?.tick();
    });
  }

  /**
   * Removes all tracked objects that are not reachable from any of the provided root objects.
   * Traverses the object graph starting from the roots and untracks all unreachable objects.
   */
  private removeUnusedObjects(): void {
    // Set of reachable TrackableObjects
    const reachable = new Set<object>();
    const stack: object[] = [];

    // Helper to add an object to the stack if not already visited
    const visit = (obj: object) => {
      if (!reachable.has(obj)) {
        reachable.add(obj);
        stack.push(obj);
      }
    };

    // Initialize stack with all root objects
    const allRootObjects = this._trackedObjectPool.all.filter((info) => {
      const hostObjectInfo = getHostObjectInfo(info)!;
      return hostObjectInfo.isRootObject;
    });
    for (const root of allRootObjects) {
      visit(root);
    }

    // Traverse the object graph
    while (stack.length > 0) {
      const current = stack.pop()!;
      const hostObjectInfo = getHostObjectInfo(current)!;

      const properties = hostObjectInfo.properties;
      // Check all properties of the current object for references to other trackable objects
      for (const key of Object.keys(properties)) {
        const value = (properties as any)[key]!.value;
        if (value && typeof value === "object") {
          visit(value);
        }
      }
    }

    // Untrack all objects that are not reachable
    for (const tracked of this._trackedObjectPool.all) {
      if (!reachable.has(tracked)) {
        this.untrackInternal(tracked, false);
      }
    }
  }
}
