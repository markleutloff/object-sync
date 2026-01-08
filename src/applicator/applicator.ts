import { checkCanApplyProperty, getSyncMethodInfo, getSyncPropertyInfo } from "../tracker/decorators.js";
import type {
  ChangeObjectMessage,
  Message,
  CreateObjectMessage,
  DeleteObjectMessage,
  ExecuteObjectMessage,
  PropertyInfos,
  ResolvablePropertyInfos,
  MethodExecuteResult,
  PropertyInfo,
} from "../shared/messages.js";
import { ensureObjectSyncMetaInfo, getObjectSyncMetaInfo } from "../shared/objectSyncMetaInfo.js";
import { TrackedObjectPool } from "../shared/trackedObjectPool.js";
import { invokeOnCreated, invokeOnDeleted, invokeOnUpdated, invokeOnUpdateProperty, invokeOnDelete } from "./trackableTarget.js";
import { ApplicatorObjectInfo } from "./applicatorObjectInfo.js";
import type { ClientConnection } from "../tracker/index.js";

type Constructor<T = any> = { new (...args: any[]): T };

export type TypeGenerator = Constructor | TrackableTargetGenerator;

export type TrackableTargetGenerator<T = any> = (client: ObjectChangeApplicator, properties: ResolvablePropertyInfos<T>, objectId: unknown, typeId: string) => T;

export type TypeSerializer<T> = {
  /**
   * The type ID of the type being serialized/deserialized.
   */
  typeId?: string;

  /**
   * The constructor of the type being serialized/deserialized.
   * When no function to serialize/deserialize is provided, this constructor will be used for deserialization and instance.toJSON()/toValue() for serialization.
   */
  type: Constructor<T>;
} & (
  | {
      /**
       * Function to deserialize a value.
       */
      deserialize: undefined;
      /**
       * Function to serialize a value.
       */
      serialize: undefined;
    }
  | {
      /**
       * Function to deserialize a value.
       */
      deserialize(value: any): T;
      /**
       * Function to serialize a value.
       */
      serialize(value: T): any;
    }
);

export const allTypeGenerators = new Map<string, TypeGenerator>();

function isGeneratorConstructor(value: TypeGenerator): value is Constructor {
  return (value as Constructor).prototype !== undefined;
}

function isGeneratorTargetGenerator(value: TypeGenerator): value is TrackableTargetGenerator {
  debugger;
  return true;
}

export type ObjectChangeApplicatorSettings = {
  objectPool: TrackedObjectPool;
  identity: string;
  typeGenerators: Map<string, TypeGenerator>;
  typeSerializers: Map<string, TypeSerializer<any>>;
};

type FinalObjectChangeApplicatorSettings = {
  identity: string;
};

type ClientApplyResult = {
  newTrackedObjects: object[];
  methodExecuteResults: MethodExecuteResult[];
};

export class ObjectChangeApplicator {
  private _trackedObjectPool: TrackedObjectPool;
  private _pendingCreationMessages = new Map<unknown, CreateObjectMessage<any>>();

  private _currentClientApplyResult: ClientApplyResult = { newTrackedObjects: [], methodExecuteResults: [] };

  private readonly _settings: FinalObjectChangeApplicatorSettings;
  private readonly _typeGenerators: Map<string, TypeGenerator>;
  private readonly _typeSerializers: Map<string, TypeSerializer<any>>;

  constructor(settings: ObjectChangeApplicatorSettings) {
    this._settings = {
      identity: settings.identity,
    };

    this._trackedObjectPool = settings.objectPool;
    this._typeSerializers = settings.typeSerializers;
    this._typeGenerators = settings.typeGenerators;
  }

  get settings(): FinalObjectChangeApplicatorSettings {
    return this._settings;
  }

  get identity(): string {
    return this._settings.identity;
  }

  registerGenerator(typeId: string, generator: TypeGenerator): void {
    if (this._typeGenerators!.has(typeId)) {
      throw new Error(`Generator for typeId ${typeId} is already registered`);
    }
    this._typeGenerators!.set(typeId, generator);
  }

  async applyAsync(messages: Message<any>[], clientConnection: ClientConnection): Promise<ClientApplyResult> {
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
      this.createNewTrackedObject(creationMessage, clientConnection);
    }

    for (const message of messages) {
      if (isChangeObjectMessage(message)) this.handleChanges(message, clientConnection);
      else if (isDeleteObjectMessage(message)) this.deleteTrackedObject(message, clientConnection);
      else if (isExecuteObjectMessage(message)) await this.executeMethodAsync(message, clientConnection);
    }

    const result = this._currentClientApplyResult!;
    this._currentClientApplyResult = { newTrackedObjects: [], methodExecuteResults: [] };
    return result;
  }

  /**
   * Resolves a property value, returning the tracked object if objectId is present, or the value otherwise.
   * If the object is not yet tracked, attempts to create it from pending messages.
   */
  getPropertyValue(property: PropertyInfo<any, any>, clientConnection: ClientConnection): any {
    const { objectId, value, typeId } = property;
    if (typeId) {
      return this.deserializeValue(typeId, value as object);
    }
    if (objectId !== undefined && objectId !== null) {
      let tracked = this._trackedObjectPool.get(objectId);
      if (!tracked) {
        // Try to create from pending messages
        const pendingMsg = this._pendingCreationMessages.get(objectId);
        if (pendingMsg) {
          this.createNewTrackedObject(pendingMsg, clientConnection);
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

  private deleteTrackedObject(data: Message<any>, clientConnection: ClientConnection): void {
    if (!isDeleteObjectMessage(data)) return;

    if (!this._trackedObjectPool.hasById(data.objectId)) {
      throw new Error(`Object with id ${data.objectId} is not being tracked`);
    }

    const tracked = this._trackedObjectPool.get(data.objectId)!;
    if (!invokeOnDelete(tracked, this, clientConnection)) return;
    this._trackedObjectPool.deleteById(data.objectId);
    invokeOnDeleted(tracked, this, clientConnection);
  }

  private constructObject(data: CreateObjectMessage<any>, clientConnection: ClientConnection) {
    if (this._trackedObjectPool.hasById(data.objectId)) {
      return;
    }

    let result: object | null = null;

    const generatorOrConstructor = this._typeGenerators.get(data.typeId);
    if (!generatorOrConstructor) {
      throw new Error(`No constructor or generator registered for typeId ${data.typeId}`);
    }

    if (isGeneratorConstructor(generatorOrConstructor)) {
      result = new generatorOrConstructor();
    } else if (isGeneratorTargetGenerator(generatorOrConstructor)) {
      const resolvablePropertyInfos = this.createResolvablePropertyInfos(data.properties, clientConnection);

      result = generatorOrConstructor(this, resolvablePropertyInfos, data.objectId, data.typeId);

      resolvablePropertyInfos.deletedProperties.forEach((key) => {
        delete (result as any)[key];
      });
    }

    if (!result) return;

    const objectInfo = ensureObjectSyncMetaInfo({
      object: result,
      objectId: data.objectId,
      typeId: data.typeId,
    });
    objectInfo.client = new ApplicatorObjectInfo<any>(objectInfo, this);

    if (!this._trackedObjectPool.has(result)) {
      this._trackedObjectPool.add(result);
      this._currentClientApplyResult.newTrackedObjects.push(result);
    }

    return;
  }

  private createResolvablePropertyInfos<T extends object>(unresolvedProperties: PropertyInfos<T>, clientConnection: ClientConnection): ResolvablePropertyInfos<T> {
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
            resolvedValue = this.getPropertyValue(propertyInfo, clientConnection);
          }
          return resolvedValue;
        },
      });
    });

    return properties as ResolvablePropertyInfos<T>;
  }

  private createNewTrackedObject(data: Message<any>, clientConnection: ClientConnection): void {
    if (!isCreateObjectMessage(data)) return;
    this._pendingCreationMessages.delete(data.objectId);

    this.constructObject(data, clientConnection);
    this.handleChanges(data, clientConnection);
  }

  private handleChanges(data: Message<any>, clientConnection: ClientConnection): void {
    const isCreate = isCreateObjectMessage(data);
    const isChange = isChangeObjectMessage(data);

    if (!isCreate && !isChange) return;

    const tracked = this._trackedObjectPool.get(data.objectId) as any;
    if (!tracked) {
      throw new Error(`Cannot find target with id ${data.objectId}`);
    }

    Object.keys(data.properties).forEach((key) => {
      if (!checkCanApplyProperty(tracked.constructor as Constructor, tracked, key, false, clientConnection)) return;
      const property = data.properties[key]!;
      const finalValue = this.getPropertyValue(property, clientConnection);

      const propertyInfo = getSyncPropertyInfo(tracked.constructor as Constructor, key);
      if (propertyInfo) propertyInfo.isBeeingApplied = true;

      try {
        if (!invokeOnUpdateProperty(tracked, key, finalValue, isCreate, this, clientConnection)) tracked[key] = finalValue;
      } finally {
        if (propertyInfo) propertyInfo.isBeeingApplied = false;
      }
    });

    if (isChange) invokeOnUpdated(tracked, data, this, clientConnection);
    else if (isCreate) invokeOnCreated(tracked, data, this, clientConnection);
  }

  private async executeMethodAsync(data: Message<any>, clientConnection: ClientConnection): Promise<void> {
    if (!isExecuteObjectMessage(data)) return;

    const tracked = this._trackedObjectPool.get(data.objectId) as any;
    if (!tracked) {
      throw new Error(`Cannot find target with id ${data.objectId}`);
    }

    if (!checkCanApplyProperty(tracked.constructor as Constructor, tracked, data.method, true, clientConnection)) {
      this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result: null, status: "rejected", error: "Not allowed." });
      return;
    }

    if (typeof tracked[data.method] !== "function") {
      throw new Error(`Target with id ${data.objectId} has no method ${data.method}`);
    }

    const methodInfo = getSyncMethodInfo(tracked.constructor as Constructor, data.method);

    const args = data.parameters.map((property) => this.getPropertyValue(property, clientConnection));
    let result: any;
    try {
      if (methodInfo) methodInfo.isBeeingApplied = true;
      result = tracked[data.method](...args);
    } catch (e) {
      this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result: null, status: "rejected", error: e });
      return;
    } finally {
      if (methodInfo) methodInfo.isBeeingApplied = false;
    }

    // Store reply, handle Promise
    if (result && typeof result.then === "function" && typeof result.catch === "function") {
      const promiseHandlingType = getSyncMethodInfo(tracked.constructor as Constructor, data.method)?.promiseHandlingType ?? "normal";
      const resolveNow = promiseHandlingType === "await";
      if (resolveNow) {
        try {
          const resolved = await result;

          this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result: resolved, status: "resolved", error: null });
        } catch (error) {
          this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result: null, status: "rejected", error: error });
        }
      } else {
        result
          .then((resolved: any) => {
            this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result: resolved, status: "resolved", error: null });
          })
          .catch((error: any) => {
            this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result: null, status: "rejected", error: error });
          });
      }
    } else {
      // Synchronous result
      this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result, status: "resolved", error: null });
    }
  }

  private deserializeValue(typeId: string, value: any) {
    const generator = this._typeSerializers.get(typeId);
    if (!generator) {
      throw new Error(`No deserializer registered for typeId ${typeId}`);
    }
    if (generator.deserialize) return generator.deserialize(value);
    else return new generator.type(value);
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
