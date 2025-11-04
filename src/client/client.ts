import { checkCanUseConstructor, checkCanUseMethod, checkCanUseProperty } from "../host/decorators.js";
import { ChangeObjectMessage, Message, CreateObjectMessage, DeleteObjectMessage, ExecuteObjectMessage, PropertyInfos, ResolvablePropertyInfos, MethodExecuteResult } from "../shared/messages.js";
import { ensureObjectSyncMetaInfo, getObjectSyncMetaInfo } from "../shared/objectSyncMetaInfo.js";
import { TrackedObjectPool } from "../shared/trackedObjectPool.js";
import { invokeOnCreated, invokeOnDeleted, invokeOnUpdated, invokeOnUpdateProperty } from "./trackableTarget.js";

type Constructor<T = any> = { new (...args: any[]): T };

export type TrackableTargetGenerator<T extends object = any> = {
  getType(client: ObjectSyncClient, properties: ResolvablePropertyInfos<T>, objectId: unknown, typeId: string): Constructor;
  create(client: ObjectSyncClient, properties: ResolvablePropertyInfos<T>, objectId: unknown, typeId: string): T;
};

export const defaultConstructorsByTypeId = new Map<string, Constructor>();
export const defaultGeneratorsByTypeId = new Map<string, TrackableTargetGenerator>();

let nextClientId = 0;

export type ObjectSyncClientSettings = {
  clientId?: unknown;
  objectPool?: TrackedObjectPool;
  designation?: string;
};

type ClientApplyResult = {
  newTrackedObjects: object[];
  methodExecuteResults: MethodExecuteResult[];
};

export class ObjectSyncClient {
  private _trackedObjectPool: TrackedObjectPool;
  private _typeIdToConstructor = new Map<string, Constructor>();
  private _typeIdToGenerator = new Map<string, TrackableTargetGenerator>();
  private _pendingCreationMessages = new Map<unknown, CreateObjectMessage<any>>();

  private _currentClientApplyResult: ClientApplyResult = { newTrackedObjects: [], methodExecuteResults: [] };

  private readonly _clientId: unknown;

  constructor(private readonly _settings: ObjectSyncClientSettings = {}) {
    this._clientId = this._settings.clientId ?? nextClientId++;
    this._trackedObjectPool = this._settings.objectPool ?? new TrackedObjectPool();

    // register default constructors and generators
    defaultConstructorsByTypeId.forEach((ctor, typeId) => this.registerConstructor(typeId, ctor));
    defaultGeneratorsByTypeId.forEach((gen, typeId) => this.registerGenerator(typeId, gen));
  }

  get clientId(): unknown {
    return this._clientId;
  }

  registerConstructorOrGenerator(typeId: string, constructorOrGenerator: Constructor | TrackableTargetGenerator): void {
    if (typeof constructorOrGenerator === "function" && constructorOrGenerator.prototype) {
      this.registerConstructor(typeId, constructorOrGenerator as Constructor);
    } else {
      this.registerGenerator(typeId, constructorOrGenerator as TrackableTargetGenerator);
    }
  }

  registerConstructor(typeId: string, constructor: Constructor): void {
    if (this._typeIdToConstructor.has(typeId)) {
      throw new Error(`Constructor for typeId ${typeId} is already registered`);
    }
    this._typeIdToConstructor.set(typeId, constructor);
  }

  registerGenerator(typeId: string, generator: TrackableTargetGenerator): void {
    if (this._typeIdToGenerator.has(typeId)) {
      throw new Error(`Generator for typeId ${typeId} is already registered`);
    }
    this._typeIdToGenerator.set(typeId, generator);
  }

  async applyAsync(messages: Message<any>[]): Promise<ClientApplyResult> {
    // sort messages by type, first all creation messages, then update, then execute, then deletion
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
      this._pendingCreationMessages.set(creationMessage.objectId, creationMessage);
    }
    while (this._pendingCreationMessages.size > 0) {
      const creationMessage = this._pendingCreationMessages.values().next().value!;
      this.createNewTrackedObject(creationMessage);
    }

    for (const message of messages) {
      if (isChangeObjectMessage(message)) this.handleChanges(message);
      else if (isDeleteObjectMessage(message)) this.deleteTrackedObject(message);
      else if (isExecuteObjectMessage(message)) await this.executeMethodAsync(message);
    }

    const result = this._currentClientApplyResult!;
    this._currentClientApplyResult = { newTrackedObjects: [], methodExecuteResults: [] };
    return result;
  }

  /**
   * Resolves a property value, returning the tracked object if objectId is present, or the value otherwise.
   * If the object is not yet tracked, attempts to create it from pending messages.
   */
  getPropertyValue(property: { objectId?: unknown; value?: any }): any {
    const { objectId, value } = property;
    if (objectId !== undefined && objectId !== null) {
      let tracked = this._trackedObjectPool.get(objectId);
      if (!tracked) {
        // Try to create from pending messages
        const pendingMsg = this._pendingCreationMessages.get(objectId);
        if (pendingMsg) {
          this.createNewTrackedObject(pendingMsg);
          tracked = this._trackedObjectPool.get(objectId);
        }
      }
      if (!tracked) {
        throw new Error(`Cannot find or create target with id ${objectId}`);
      }
      return tracked;
    }
    return value;
  }

  findObjectOfType<T extends object>(constructor: Constructor<T>, objectId?: unknown) {
    for (const tracked of this._trackedObjectPool.all) {
      if (tracked instanceof constructor) {
        const metaInfo = getObjectSyncMetaInfo(tracked)!;
        if (objectId !== undefined && metaInfo.objectId !== objectId) continue;
        return tracked;
      }
    }
    return null;
  }

  findObjectsOfType<T extends object>(constructor: Constructor<T>) {
    const results: T[] = [];
    for (const tracked of this._trackedObjectPool.all) {
      if (tracked instanceof constructor) {
        return results.push(tracked as T);
      }
    }
    return results;
  }

  get allTrackedObjects(): object[] {
    return Array.from(this._trackedObjectPool.all);
  }

  private deleteTrackedObject(data: Message<any>): void {
    if (!isDeleteObjectMessage(data)) return;

    if (!this._trackedObjectPool.hasById(data.objectId)) {
      throw new Error(`Object with id ${data.objectId} is not being tracked`);
    }

    const tracked = this._trackedObjectPool.get(data.objectId)!;
    this._trackedObjectPool.deleteById(data.objectId);

    invokeOnDeleted(tracked);
  }

  private constructObject(data: CreateObjectMessage<any>) {
    if (this._trackedObjectPool.hasById(data.objectId)) {
      return;
    }

    const constructor = this._typeIdToConstructor.get(data.typeId);
    let result: object;
    if (constructor) {
      if (!checkCanUseConstructor(constructor, this._settings.designation)) {
        throw new Error(`Cannot construct ttype ${data.typeId}`);
      }
      result = new constructor();
    } else {
      const generator = this._typeIdToGenerator.get(data.typeId);
      if (!generator) {
        throw new Error(`No constructor or generator registered for typeId ${data.typeId}`);
      }
      const resolvablePropertyInfos = this.createResolvablePropertyInfos(data.properties);

      const type = generator.getType(this, resolvablePropertyInfos, data.objectId, data.typeId);
      if (!checkCanUseConstructor(type, this._settings.designation)) {
        throw new Error(`Cannot construct ttype ${data.typeId}`);
      }

      result = generator.create(this, resolvablePropertyInfos, data.objectId, data.typeId);

      resolvablePropertyInfos.deletedProperties.forEach((key) => {
        delete (result as any)[key];
      });
    }

    if (!result) return;

    ensureObjectSyncMetaInfo({
      object: result,
      objectId: data.objectId,
      typeId: data.typeId,
    });

    if (!this._trackedObjectPool.has(result)) {
      this._trackedObjectPool.add(result);
      this._currentClientApplyResult.newTrackedObjects.push(result);
    }

    return;
  }

  private createResolvablePropertyInfos<T extends object>(unresolvedProperties: PropertyInfos<T>): ResolvablePropertyInfos<T> {
    const deletedProperties: Set<string> = new Set();
    const properties: ResolvablePropertyInfos<any> = {
      deleteProperty(key: string) {
        deletedProperties.add(key);
      },
      get deletedProperties(): string[] {
        return Array.from(deletedProperties);
      },
    };
    Object.keys(unresolvedProperties).forEach((key) => {
      const propertyInfo = unresolvedProperties[key as keyof T]!;
      let resolvedValue: any = undefined;
      let hasResolved = false;
      Object.defineProperty(properties, key, {
        get: () => {
          if (!hasResolved) {
            hasResolved = true;
            resolvedValue = this.getPropertyValue(propertyInfo);
          }
          return resolvedValue;
        },
      });
    });

    return properties as ResolvablePropertyInfos<T>;
  }

  private createNewTrackedObject(data: Message<any>): void {
    if (!isCreateObjectMessage(data)) return;
    this._pendingCreationMessages.delete(data.objectId);

    this.constructObject(data);
    this.handleChanges(data);
  }

  private handleChanges(data: Message<any>): void {
    const isCreate = isCreateObjectMessage(data);
    const isChange = isChangeObjectMessage(data);

    if (!isCreate && !isChange) return;

    const tracked = this._trackedObjectPool.get(data.objectId) as any;
    if (!tracked) {
      throw new Error(`Cannot find target with id ${data.objectId}`);
    }

    Object.keys(data.properties).forEach((key) => {
      if (!checkCanUseProperty(tracked.constructor as Constructor, key, this._settings.designation)) return;
      const property = data.properties[key]!;
      const finalValue = this.getPropertyValue(property);
      if (!invokeOnUpdateProperty(tracked, key, finalValue, isCreate, this)) tracked[key] = finalValue;
    });

    if (isChange) invokeOnUpdated(tracked, data);
    else if (isCreate) invokeOnCreated(tracked, data);
  }

  private async executeMethodAsync(data: Message<any>): Promise<void> {
    if (!isExecuteObjectMessage(data)) return;

    const tracked = this._trackedObjectPool.get(data.objectId) as any;
    if (!tracked) {
      throw new Error(`Cannot find target with id ${data.objectId}`);
    }

    if (!checkCanUseMethod(tracked.constructor as Constructor, data.method, this._settings.designation)) {
      this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result: null, status: "sync", error: "Not allowed." });
      return;
    }

    if (typeof tracked[data.method] !== "function") {
      throw new Error(`Target with id ${data.objectId} has no method ${data.method}`);
    }

    const args = data.parameters.map((property) => this.getPropertyValue(property));
    const result = tracked[data.method](...args);

    // Store reply, handle Promise
    if (result && typeof result.then === "function" && typeof result.catch === "function") {
      try {
        const resolved = await result;

        this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result: resolved, status: "resolved", error: null });
      } catch (error) {
        this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result: null, status: "rejected", error: error });
      }
    } else {
      // Synchronous result
      this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result, status: "sync", error: null });
    }
  }
}

function isDeleteObjectMessage<T extends object = any>(change: Message<T>): change is DeleteObjectMessage {
  return change.type === "delete";
}

function isCreateObjectMessage<T extends object = any>(change: Message<T>): change is CreateObjectMessage<T> {
  return change.type === "create";
}

function isChangeObjectMessage<T extends object = any>(change: Message<T>): change is ChangeObjectMessage<T> {
  return change.type === "change";
}

function isExecuteObjectMessage<T extends object = any>(change: Message<T>): change is ExecuteObjectMessage<T> {
  return change.type === "execute";
}
