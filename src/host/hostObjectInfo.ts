import {
  PropertyInfo,
  CreateObjectMessage,
  PropertyInfos,
  ChangeObjectMessage,
  Message,
  DeleteObjectMessage,
  ExecuteObjectMessage,
  isPropertyInfoSymbol,
  ObjectSync,
  MethodExecuteResult,
} from "../shared/index.js";
import { checkCanUseMethod, checkCanUseProperty, getTrackableTypeInfo } from "./decorators.js";
import { ClientConnection, ObjectSyncHost } from "./host.js";
import { ensureObjectSyncMetaInfo, getObjectSyncMetaInfo, ObjectSyncMetaInfo, ObjectSyncMetaInfoCreateSettings, ObjectInfoBase } from "../shared/objectSyncMetaInfo.js";
import { invokeOnConvertedToTrackable, invokeOnTick } from "./trackedTarget.js";
import { Constructor, hasInIterable, OneOrMany, toIterable } from "../shared/types.js";

export type AdditionalHostPropertyInfo = {
  hasPendingChanges: boolean;
};

export type HostChangeObjectMessage<T extends object = object> = ChangeObjectMessage<T, AdditionalHostPropertyInfo>;
export type HostMessage<T extends object = object> = Message<T, AdditionalHostPropertyInfo>;

let nextInvokeId = 0;

export type ClientFilter = {
  /**
   * Set of clients to include or exclude
   */
  clients?: OneOrMany<ClientConnection>;

  /**
   * Set of client designations to include or exclude
   */
  designations?: OneOrMany<string>;

  /**
   * If true, only the specified clients are included; if false, they are excluded, default is true
   */
  isExclusive?: boolean;
};

function isForClientConnection(clientConnection: ClientConnection, filter: ClientFilter): boolean {
  let hasDesignation = filter.designations === undefined || clientConnection.designation === undefined;
  if (!hasDesignation) {
    hasDesignation = hasInIterable(filter.designations!, clientConnection.designation);
  }

  let hasClientConnection = filter.clients === undefined;
  if (!hasClientConnection) {
    hasClientConnection = hasInIterable(filter.clients!, clientConnection);
  }

  return filter.isExclusive === (hasDesignation && hasClientConnection);
}

export type ClientSpecificView<T extends object> = {
  /**
   * Optional filter to restrict the view to specific clients
   */
  filter?: ClientFilter;

  /**
   * Callback to modify property info before sending to the client; return null to exclude the property
   * @param client The client requesting the property info
   * @param key The property key
   * @param propertyInfo The current property info
   */
  onProperty?<TKey extends keyof T>(client: ClientConnection, key: TKey, propertyInfo: PropertyInfo<T, TKey>): PropertyInfo<T, TKey> | null;

  /**
   * Callback to modify the typeId before sending to the client; return null to exclude the object from beeing sent to the client
   * @param client The client requesting the typeId
   * @param typeId The current typeId of the object
   */
  onTypeId?(client: ClientConnection, typeId: string): string | null;
};

export type ServerObjectSyncMetaInfoCreateSettings<T extends object> = ObjectSyncMetaInfoCreateSettings<T> & {
  isRoot: boolean;
  objectIdPrefix: string;
  owner: ObjectSyncHost;
};

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
export type MethodCallResultByClient<T> = Map<ClientConnection, Promise<UnwrapPromise<T>>>;

export type MethodCallResult<T> = {
  resultsByClient: Promise<MethodCallResultByClient<T>>;
  hostResult: T;
};

type PendingMethodCall = {
  id: unknown;
  remainingClients: ClientConnection[];
  resultByClient: Map<ClientConnection, Promise<any>>;
  result: MethodCallResult<any>;
  onRemainingClientsResolved: (value: Map<ClientConnection, Promise<any>>) => void;
};

/**
 * TrackableObject wraps an object for change tracking and client synchronization on the host side.
 * It manages property changes, client-specific views, and message generation for create, change, delete, and execute operations.
 */
export class HostObjectInfo<T extends object> extends ObjectInfoBase {
  /**
   * Creates a TrackableObject from a plain object, optionally specifying typeId and objectId.
   * Registers tracked properties and initializes their values.
   */
  static createFromObject<T extends object>(settings: ServerObjectSyncMetaInfoCreateSettings<T>): HostObjectInfo<T> {
    const metaInfo = ensureObjectSyncMetaInfo(settings);
    if (!metaInfo) {
      throw new Error("Failed to create HostObjectInfo: unable to ensure ObjectSyncMetaInfo.");
    }
    metaInfo.host = new HostObjectInfo<T>(metaInfo, settings.owner, settings.isRoot, settings.objectIdPrefix);
    invokeOnConvertedToTrackable(metaInfo.object as T, metaInfo.host);

    const trackableTypeInfo = getTrackableTypeInfo((settings.object as any).constructor);
    if (trackableTypeInfo) {
      trackableTypeInfo.trackedProperties.forEach((propertyInfo, key) => {
        metaInfo.host!.onPropertyChanged(key as keyof T, (settings.object as any)[key]);
      });
    }
    return metaInfo.host!;
  }

  /**
   * Ensures an object is auto-trackable, returning a TrackableObject if possible.
   * If the object is already trackable, returns the existing wrapper.
   */
  static tryEnsureAutoTrackable<T extends object>(settings: ServerObjectSyncMetaInfoCreateSettings<T>): HostObjectInfo<T> | null {
    if (!settings.object || typeof settings.object !== "object") return null;

    const trackableTypeInfo = getTrackableTypeInfo((settings.object as any).constructor);
    if (trackableTypeInfo?.isAutoTrackable !== true) return null;

    const metaInfo = ensureObjectSyncMetaInfo(settings);
    if (!metaInfo) {
      throw new Error("Failed to create HostObjectInfo: unable to ensure ObjectSyncMetaInfo.");
    }

    return metaInfo.host ?? this.createFromObject(settings);
  }

  /** Holds the current set of property changes for this object. */
  private readonly _changeSet: HostChangeObjectMessage<T>;
  /** Holds pending method invocation messages for this object. */
  private readonly _methodInvokeCalls: ExecuteObjectMessage<T>[] = [];
  private readonly _pendingMethodInvokeCalls: Map<unknown, PendingMethodCall> = new Map();
  /** Holds client filter settings for restricting visibility. */
  private _clientFilters: ClientFilter | null = null;
  /** Holds all registered client-specific views for this object. */
  private _views: ClientSpecificView<T>[] = [];
  /** Holds the set of clients which know about this. */
  private _clients: Set<ClientConnection> = new Set();

  /**
   * Constructs a TrackableObject with a typeId and optional objectId.
   */
  private constructor(objectSyncMetaInfo: ObjectSyncMetaInfo, private readonly _host: ObjectSyncHost, private _isRootObject: boolean, private readonly _objectIdPrefix: string) {
    super(objectSyncMetaInfo);

    this._changeSet = {
      type: "change",
      objectId: this.objectId,
      properties: {},
    };
  }

  get host() {
    return this._host;
  }

  get clients(): Set<ClientConnection> {
    return this._clients;
  }

  get isRootObject() {
    return this._isRootObject;
  }
  set isRootObject(value: boolean) {
    this._isRootObject = value;
  }

  get properties(): PropertyInfos<T, AdditionalHostPropertyInfo> {
    return this._changeSet.properties;
  }

  /**
   * Determines if this object is visible to a given client based on filters.
   */
  isForClient(client: ClientConnection): boolean {
    if (!this._clientFilters) return true;

    const filter = this._clientFilters;
    return isForClientConnection(client, filter);
  }

  /**
   * Adds a client-specific view to this object.
   */
  addView(view: ClientSpecificView<T>): void {
    this._views.push(view);
  }

  /**
   * Removes a client-specific view from this object.
   * @returns true if the view was removed, false otherwise.
   */
  removeView(view: ClientSpecificView<T>): boolean {
    const initialLength = this._views.length;
    this._views = this._views.filter((v) => v !== view);
    return this._views.length < initialLength;
  }

  /**
   * Returns all registered client-specific views for this object.
   */
  get allRegisteredViews(): readonly ClientSpecificView<T>[] {
    return this._views;
  }

  /**
   * Returns all views that applyAsync to a given client.
   */
  getViewsForClient(client: ClientConnection): ClientSpecificView<T>[] {
    return this._views.filter((view) => !view.filter || hasInIterable(view.filter.clients, client) === view.filter.isExclusive);
  }

  /**
   * Removes all client restrictions, making the object visible to all clients.
   */
  removeClientRestrictions(): void {
    this._clientFilters = null;
  }

  /**
   * Restricts the object to a set of clients (inclusive or exclusive).
   */
  setClientRestriction(filter: ClientFilter): void {
    this._clientFilters = {
      clients: filter.clients ? toIterable(filter.clients, true) : undefined,
      designations: filter.designations ? toIterable(filter.designations, true) : undefined,
      isExclusive: filter.isExclusive ?? true,
    };
  }

  /**
   * Records a property change, converting values to trackable references if needed.
   */
  onPropertyChanged(key: keyof T, value: T[keyof T]) {
    let current = this._changeSet.properties[key];
    if (!current) {
      current = { hasPendingChanges: true, [isPropertyInfoSymbol]: true };
      this._changeSet.properties[key] = current;
    } else if (current.value === value) {
      return;
    }

    this.convertToTrackableObjectReference(value as any);

    const metaInfo = getObjectSyncMetaInfo(value as object);
    const objectId: unknown = metaInfo?.objectId;
    current.value = value as any;
    current.objectId = objectId;
    current.hasPendingChanges = true;
  }

  /**
   * Records a method execution for this object, converting arguments to trackable references if needed.
   */
  onMethodExecute(method: keyof T, args: any[], hostResult: any) {
    const parameters: PropertyInfos<any, any>[] = [];
    args.forEach((arg, index) => {
      const trackable = this.convertToTrackableObjectReference(arg);
      const paramInfo: PropertyInfo<any, any> = {
        value: trackable ?? arg,
        objectId: trackable?.objectSyncMetaInfo.objectId,
        [isPropertyInfoSymbol]: true,
      };
      parameters.push(paramInfo);
    });

    const message: ExecuteObjectMessage<T> = {
      type: "execute",
      id: nextInvokeId++,
      objectId: this.objectId,
      parameters: parameters as any,
      method: method as any,
    };

    this._methodInvokeCalls.push(message);

    let onRemainingClientsResolved: (result: Map<ClientConnection, Promise<T>>) => void;
    const resultsByClient = new Promise<Map<ClientConnection, Promise<T>>>((resolve) => {
      onRemainingClientsResolved = resolve;
    });

    const result: MethodCallResult<any> = {
      hostResult,
      resultsByClient,
    };

    this._pendingMethodInvokeCalls.set(message.id, {
      id: message.id,
      resultByClient: new Map(),
      remainingClients: [],
      result,
      onRemainingClientsResolved: onRemainingClientsResolved!,
    });

    return result;
  }

  private onClientMethodExecuteSendToClient(client: ClientConnection, invokeId: unknown) {
    const pendingCall = this._pendingMethodInvokeCalls.get(invokeId);
    if (!pendingCall) return;

    pendingCall.remainingClients.push(client);
  }

  onClientMethodExecuteResultReceived(methodExecuteResult: MethodExecuteResult, client: ClientConnection) {
    const pendingCall = this._pendingMethodInvokeCalls.get(methodExecuteResult.id);
    if (!pendingCall) return;

    if (this.clients.has(client)) {
      pendingCall.resultByClient.set(
        client,
        new Promise<any>((resolve, reject) => {
          if (methodExecuteResult.status === "resolved" || methodExecuteResult.status === "sync") {
            resolve(methodExecuteResult.result);
          } else {
            reject(methodExecuteResult.error);
          }
        })
      );
    }

    pendingCall.remainingClients = pendingCall.remainingClients.filter((c) => c !== client);
    if (pendingCall.remainingClients.length === 0) {
      this._pendingMethodInvokeCalls.delete(methodExecuteResult.id);
      pendingCall.onRemainingClientsResolved(pendingCall.resultByClient);
    }
  }

  /**
   * Converts a value to a trackable object reference if possible.
   */
  public convertToTrackableObjectReference(target: object) {
    if (target && typeof target === "object") {
      return HostObjectInfo.tryEnsureAutoTrackable({
        object: target,
        isRoot: false,
        objectIdPrefix: this._objectIdPrefix,
        owner: this.host,
      });
    }
    return null;
  }

  /**
   * Generates a create message for this object for a given client, applying any view-based typeId overrides.
   * Returns null if the object should not be sent to the client.
   */
  getCreateMessage(client: ClientConnection): CreateObjectMessage<T> | null {
    let typeId = this.typeId;
    const views = this.getViewsForClient(client).filter((v) => v.onTypeId);
    for (const view of views) {
      const newTypeId = view.onTypeId!(client, typeId);
      if (!newTypeId) return null;
      typeId = newTypeId;
    }
    const result: CreateObjectMessage<T> = {
      type: "create",
      objectId: this.objectId,
      typeId,
      properties: this.getProperties(client, false),
    };
    return result;
  }

  /**
   * Generates a delete message for this object.
   */
  getDeleteMessage(): DeleteObjectMessage {
    const result: DeleteObjectMessage = {
      type: "delete",
      objectId: this.objectId,
    };
    this.cancelPendingMethodCalls();
    return result;
  }

  onClientRemoved(clientConnection: ClientConnection) {
    this.clients.delete(clientConnection);
    this.cancelPendingMethodCalls(clientConnection);
  }

  cancelPendingMethodCalls(clientConnection?: ClientConnection): void {
    this._pendingMethodInvokeCalls.forEach((pendingCall) => {
      pendingCall.remainingClients.forEach((client) => {
        if (clientConnection && client !== clientConnection) return;
        this.onClientMethodExecuteResultReceived(
          {
            id: pendingCall.id,
            status: "rejected",
            error: new Error("Object deleted before method could be executed"),
            objectId: this.objectId,
            result: undefined,
          },
          client
        );
      });
    });
  }

  /**
   * Generates a change message for this object for a given client, including only changed properties.
   * Returns null if there are no changes.
   */
  getChangeMessage(client: ClientConnection): ChangeObjectMessage<T> | null {
    const properties = this.getProperties(client, true);
    if (Object.keys(properties).length === 0) return null;
    const result: ChangeObjectMessage<T> = {
      type: "change",
      objectId: this.objectId,
      properties,
    };
    return result;
  }

  /**
   * Returns all pending execute messages for this object.
   */
  getExecuteMessages(client: ClientConnection): ExecuteObjectMessage<T>[] {
    const result = this._methodInvokeCalls.filter((msg) => {
      return checkCanUseMethod(this.object.constructor as Constructor, msg.method, client.designation);
    });
    result.forEach((msg) => {
      this.onClientMethodExecuteSendToClient(client, msg.id);
    });
    return result;
  }

  /**
   * Gathers property info for this object for a given client, applying any view-based property overrides.
   * If includeChangedOnly is true, only changed properties are included.
   */
  private getProperties(client: ClientConnection, includeChangedOnly: boolean): PropertyInfos<T> {
    const views = this.getViewsForClient(client).filter((v) => v.onProperty);
    const result: PropertyInfos<T> = {};
    Object.keys(this._changeSet.properties).forEach((key) => {
      const propertyInfo = this._changeSet.properties[key as keyof T]!;
      if (includeChangedOnly && !propertyInfo.hasPendingChanges) return;

      if (!checkCanUseProperty(this.object.constructor as Constructor, key, client.designation)) return;

      let clientPropertyInfo: PropertyInfo<T, keyof T> = {
        objectId: propertyInfo.objectId,
        value: propertyInfo.value,
        [isPropertyInfoSymbol]: true,
      };

      if (propertyInfo.objectId === undefined && propertyInfo.objectId === null) {
        delete clientPropertyInfo.objectId;
      }

      for (const view of views) {
        const newPropertyInfo = view.onProperty!(client, key as keyof T, clientPropertyInfo);
        if (newPropertyInfo === null) {
          return;
        }
        clientPropertyInfo = newPropertyInfo;
      }
      result[key as keyof T] = clientPropertyInfo;
    });
    return result;
  }

  /**
   * Resets the hasPendingChanges flag for all properties and clears pending method calls.
   */
  tick(): void {
    Object.keys(this._changeSet.properties).forEach((key) => {
      const propertyInfo = this._changeSet.properties[key as keyof T]!;
      propertyInfo.hasPendingChanges = false;
    });
    this._methodInvokeCalls.length = 0;

    invokeOnTick(this.objectSyncMetaInfo.object as T);
  }
}
