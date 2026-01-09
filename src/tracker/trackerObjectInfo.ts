import { PropertyInfo, CreateObjectMessage, PropertyInfos, ChangeObjectMessage, DeleteObjectMessage, ExecuteObjectMessage, isPropertyInfoSymbol, MethodExecuteResult } from "../shared/index.js";
import { beforeSendObjectToClient, beforeSendPropertyToClient, beforeExecuteOnClient, getTrackableTypeInfo, nothing } from "./decorators.js";
import { ClientConnection, ObjectChangeTracker } from "./tracker.js";
import { ensureObjectSyncMetaInfo, getObjectSyncMetaInfo, ObjectSyncMetaInfo, ObjectSyncMetaInfoCreateSettings } from "../shared/objectSyncMetaInfo.js";
import { invokeOnConvertedToTrackable, invokeOnTick } from "./interfaces.js";
import { Constructor, hasInIterable, OneOrMany, toIterable } from "../shared/types.js";
import { ObjectInfoBase } from "../shared/objectInfoBase.js";

type PropertyChanges<T> = { [K in keyof T]?: { value: T[K]; hasPendingChanges: boolean } };

type TResult<T, K extends keyof T> = T[K] extends (...args: any[]) => any ? ReturnType<T[K]> : never;

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
  let hasDesignation = filter.designations === undefined || clientConnection.identity === undefined;
  if (!hasDesignation) {
    hasDesignation = hasInIterable(filter.designations!, clientConnection.identity);
  }

  let hasClientConnection = filter.clients === undefined;
  if (!hasClientConnection) {
    hasClientConnection = hasInIterable(filter.clients!, clientConnection);
  }

  return filter.isExclusive === (hasDesignation && hasClientConnection);
}

export type ChangeTrackerObjectSyncMetaInfoCreateSettings<T extends object> = ObjectSyncMetaInfoCreateSettings<T> & {
  isRoot: boolean;
  objectIdPrefix: string;
  owner: ObjectChangeTracker;
};

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
export type MethodCallResultByClient<T> = Map<ClientConnection, Promise<UnwrapPromise<T>>>;

export type MethodCallResult<T> = Promise<MethodCallResultByClient<T>>;

type PendingMethodCall = {
  id: unknown;
  remainingClients: ClientConnection[];
  resultByClient: Map<ClientConnection, Promise<any>>;
  result: MethodCallResult<any>;
  onRemainingClientsResolved: (value: Map<ClientConnection, Promise<any>>) => void;
};

/**
 * Wraps an object for change tracking and client synchronization on the host side.
 * It manages property changes, client-specific views, and message generation for create, change, delete, and execute operations.
 */
export class ChangeTrackerObjectInfo<T extends object> extends ObjectInfoBase {
  /**
   * Ensures an object is auto-trackable, returning a TrackableObject if possible.
   * If the object is already trackable, returns the existing wrapper.
   */
  static create<T extends object>(settings: ChangeTrackerObjectSyncMetaInfoCreateSettings<T>): ChangeTrackerObjectInfo<T> | null {
    if (!settings.object || typeof settings.object !== "object") return null;

    const trackableTypeInfo = getTrackableTypeInfo((settings.object as any).constructor);
    if (!trackableTypeInfo) return null;

    const metaInfo = ensureObjectSyncMetaInfo(settings);
    if (!metaInfo) {
      throw new Error("Failed to create HostObjectInfo: unable to ensure ObjectSyncMetaInfo.");
    }

    if (metaInfo.host) return metaInfo.host;

    metaInfo.host = new ChangeTrackerObjectInfo<T>(metaInfo, settings.owner, settings.isRoot, settings.objectIdPrefix);
    invokeOnConvertedToTrackable(metaInfo.object as T, metaInfo.host);
    trackableTypeInfo.trackedProperties.forEach((propertyInfo, key) => {
      metaInfo.host!.onPropertyChanged(key as keyof T, (settings.object as any)[key]);
    });
    return metaInfo.host!;
  }

  /** Holds the current set of property changes for this object. */
  private readonly _changeSet: PropertyChanges<T> = {};
  /** Holds pending method invocation messages for this object. */
  private readonly _methodInvokeCalls: ExecuteObjectMessage<T>[] = [];
  private readonly _pendingMethodInvokeCalls: Map<unknown, PendingMethodCall> = new Map();
  /** Holds client filter settings for restricting visibility. */
  private _clientFilters: ClientFilter | null = null;
  /** Holds the set of clients which know about this. */
  private _clients: Set<ClientConnection> = new Set();

  private _lastMethodCallResult: MethodCallResult<any> | null = null;

  /**
   * Constructs a TrackableObject with a typeId and optional objectId.
   */
  private constructor(objectSyncMetaInfo: ObjectSyncMetaInfo, private readonly _host: ObjectChangeTracker, private _isRootObject: boolean, private readonly _objectIdPrefix: string) {
    super(objectSyncMetaInfo);
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

  get properties() {
    return this._changeSet;
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
    let current = this._changeSet[key];
    if (!current) {
      current = { hasPendingChanges: true, value };
      this._changeSet[key] = current;
      return;
    }
    if (current.value === value) return;

    current.value = value as any;
    current.hasPendingChanges = true;

    // this.convertToTrackableObjectReference(value as any);

    // const metaInfo = getObjectSyncMetaInfo(value as object);
    // const objectId: unknown = metaInfo?.objectId;
    // current.value = value as any;
    // current.hasPendingChanges = true;
  }

  createPropertyInfo(value: any): PropertyInfo<T, keyof T> {
    const trackable = this.convertToTrackableObjectReference(value);
    const paramInfo: PropertyInfo<any, any> = {
      value: /*trackable ?? */value,
      objectId: trackable?.objectSyncMetaInfo.objectId,
      [isPropertyInfoSymbol]: true,
    };

    return paramInfo;
  }

  /**
   * Records a method execution for this object, converting arguments to trackable references if needed.
   */
  onMethodExecute(method: keyof T, parameters: any[]) {
    const message: ExecuteObjectMessage<T> = {
      type: "execute",
      id: nextInvokeId++,
      objectId: this.objectId,
      parameters,
      method: method as any,
    };

    this._methodInvokeCalls.push(message);

    let onRemainingClientsResolved: (result: Map<ClientConnection, Promise<T>>) => void;
    const result = new Promise<Map<ClientConnection, Promise<T>>>((resolve) => {
      onRemainingClientsResolved = resolve;
    });

    this._pendingMethodInvokeCalls.set(message.id, {
      id: message.id,
      resultByClient: new Map(),
      remainingClients: [],
      result,
      onRemainingClientsResolved: onRemainingClientsResolved!,
    });

    this._lastMethodCallResult = result;

    return result;
  }

  getInvokeResults<K extends keyof T = any>(method?: K): MethodCallResult<TResult<T, K>> | null {
    const result = this._lastMethodCallResult;
    this._lastMethodCallResult = null;
    return result as MethodCallResult<TResult<T, K>> | null;
  }

  invoke<K extends keyof T>(method: K, ...args: T[K] extends (...a: infer P) => any ? P : never): { clientResults: MethodCallResult<TResult<T, K>>; hostResult: TResult<T, K> } {
    const hostResult = (this.object as any)[method](...args) as TResult<T, K>;
    const clientResults = this.getInvokeResults<K>(method)!;
    return { clientResults, hostResult };
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
          if (methodExecuteResult.status === "resolved") {
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
      return ChangeTrackerObjectInfo.create({
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
    const typeIdOrNothing = beforeSendObjectToClient(this.object.constructor as Constructor, this.object, this.typeId, client);
    if (typeIdOrNothing === nothing) return null;

    const typeId = typeIdOrNothing as string;

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
    const result: ExecuteObjectMessage<T>[] = [];
    for (const methodExecuteCall of this._methodInvokeCalls) {
      const args = methodExecuteCall.parameters.slice();
      if (beforeExecuteOnClient(this.object.constructor as Constructor, this.object, methodExecuteCall.method, args, client) === false) {
        continue;
      }

      result.push({
        ...methodExecuteCall,
        parameters: args.map((arg) => this.createPropertyInfo(arg)),
      });
    }

    return result;
  }

  /**
   * Gathers property info for this object for a given client, applying any view-based property overrides.
   * If includeChangedOnly is true, only changed properties are included.
   */
  private getProperties(client: ClientConnection, includeChangedOnly: boolean): PropertyInfos<T> {
    const result: PropertyInfos<T> = {};
    Object.keys(this._changeSet).forEach((key) => {
      let propertyStateInfo = this._changeSet[key as keyof T]!;
      if (includeChangedOnly && !propertyStateInfo.hasPendingChanges) return;

      const finalValue = beforeSendPropertyToClient(this.object.constructor as Constructor, this.object, key, propertyStateInfo.value, client);
      if (finalValue === nothing) return;

      const propertyInfo = this.createPropertyInfo(finalValue);

      const clientPropertyInfo = this.serializePropertyInfo(key as keyof T, propertyInfo as PropertyInfo<T, keyof T>, client);
      if (clientPropertyInfo) result[key as keyof T] = clientPropertyInfo;
    });
    return result;
  }

  private serializePropertyInfo(key: keyof T, propertyInfo: PropertyInfo<T, keyof T>, client: ClientConnection) {
    let clientPropertyInfo: PropertyInfo<T, keyof T> = {
      objectId: propertyInfo.objectId,
      value: propertyInfo.value,
      [isPropertyInfoSymbol]: true,
    };

    if (propertyInfo.objectId === undefined && propertyInfo.objectId === null) {
      delete clientPropertyInfo.objectId;
    }

    if (clientPropertyInfo.value && clientPropertyInfo.objectId === undefined && typeof clientPropertyInfo.value === "object") {
      const serializedValue = this.serializeValue(clientPropertyInfo.value);
      if (serializedValue === null) {
        clientPropertyInfo.value = clientPropertyInfo.value;
      } else {
        clientPropertyInfo.value = serializedValue.value as any;
        clientPropertyInfo.typeId = serializedValue.typeId;
      }
    }

    return clientPropertyInfo;
  }

  private serializeValue(value: object) {
    return this.host.serializeValue(value);
  }

  /**
   * Resets the hasPendingChanges flag for all properties and clears pending method calls.
   */
  tick(): void {
    Object.keys(this._changeSet).forEach((key) => {
      const propertyInfo = this._changeSet[key as keyof T]!;
      propertyInfo.hasPendingChanges = false;
    });
    this._methodInvokeCalls.length = 0;

    invokeOnTick(this.objectSyncMetaInfo.object as T);
  }
}
