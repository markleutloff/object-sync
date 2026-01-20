var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// build/shared/decorators.js
Symbol.metadata ?? (Symbol.metadata = Symbol("metadata"));

// build/shared/messages.js
var isPropertyInfoSymbol = Symbol("isPropertyInfo");
function isPropertyInfo(value) {
  return isPropertyInfoSymbol in value;
}

// build/applicator/trackableTarget.js
var onCreated = Symbol("onCreated");
var onUpdated = Symbol("onUpdated");
var onUpdateProperty = Symbol("onUpdateProperty");
var onDelete = Symbol("onDelete");
var onDeleted = Symbol("onDeleted");
function hasOnCreated(obj) {
  return onCreated in obj;
}
function hasOnDeleted(obj) {
  return onDeleted in obj;
}
function hasOnDelete(obj) {
  return onDelete in obj;
}
function hasOnUpdated(obj) {
  return onUpdated in obj;
}
function hasOnUpdateProperty(obj) {
  return onUpdateProperty in obj;
}
function invokeOnCreated(obj, changes, client, clientConnection) {
  if (hasOnCreated(obj)) {
    obj[onCreated](changes, client, clientConnection);
  }
}
function invokeOnUpdated(obj, changes, client, clientConnection) {
  if (hasOnUpdated(obj)) {
    obj[onUpdated](changes, client, clientConnection);
  }
}
function invokeOnDeleted(obj, client, clientConnection) {
  if (hasOnDeleted(obj)) {
    obj[onDeleted](client, clientConnection);
  }
}
function invokeOnDelete(obj, client, clientConnection) {
  if (hasOnDelete(obj)) {
    obj[onDelete](client, clientConnection);
  }
  return true;
}
function invokeOnUpdateProperty(obj, key, value, isForCreate, client, clientConnection) {
  if (hasOnUpdateProperty(obj)) {
    return obj[onUpdateProperty](key, value, isForCreate, client, clientConnection);
  }
  return false;
}

// build/shared/objectInfoBase.js
var ObjectInfoBase = class {
  constructor(_objectSyncMetaInfo) {
    __publicField(this, "_objectSyncMetaInfo");
    this._objectSyncMetaInfo = _objectSyncMetaInfo;
  }
  get objectId() {
    return this._objectSyncMetaInfo.objectId;
  }
  get typeId() {
    return this._objectSyncMetaInfo.typeId;
  }
  get object() {
    return this._objectSyncMetaInfo.object;
  }
  get objectSyncMetaInfo() {
    return this._objectSyncMetaInfo;
  }
};

// build/applicator/applicatorObjectInfo.js
var ApplicatorObjectInfo = class extends ObjectInfoBase {
  constructor(objectSyncMetaInfo, _applicator) {
    super(objectSyncMetaInfo);
    __publicField(this, "_applicator");
    this._applicator = _applicator;
  }
  get applicator() {
    return this._applicator;
  }
};

// build/applicator/applicator.js
var allTypeGenerators = /* @__PURE__ */ new Map();
function isGeneratorConstructor(value) {
  return value.prototype !== void 0;
}
function isGeneratorTargetGenerator(value) {
  return true;
}
var ObjectChangeApplicator = class {
  constructor(settings) {
    __publicField(this, "_trackedObjectPool");
    __publicField(this, "_pendingCreationMessages", /* @__PURE__ */ new Map());
    __publicField(this, "_currentClientApplyResult", { newTrackedObjects: [], methodExecuteResults: [] });
    __publicField(this, "_settings");
    __publicField(this, "_typeGenerators");
    __publicField(this, "_typeSerializers");
    __publicField(this, "_nativeTypeSerializers");
    this._settings = {
      identity: settings.identity
    };
    this._trackedObjectPool = settings.objectPool;
    this._typeSerializers = settings.typeSerializers;
    this._nativeTypeSerializers = settings.nativeTypeSerializers;
    this._typeGenerators = settings.typeGenerators;
  }
  get settings() {
    return this._settings;
  }
  get identity() {
    return this._settings.identity;
  }
  registerGenerator(typeId, generator) {
    if (this._typeGenerators.has(typeId)) {
      throw new Error(`Generator for typeId ${typeId} is already registered`);
    }
    this._typeGenerators.set(typeId, generator);
  }
  async applyAsync(messages, clientConnection) {
    messages.sort((a, b) => {
      if (a.type === b.type)
        return 0;
      if (a.type === "create")
        return -1;
      if (b.type === "create")
        return 1;
      if (a.type === "change")
        return -1;
      if (b.type === "change")
        return 1;
      if (a.type === "execute")
        return -1;
      if (b.type === "execute")
        return 1;
      if (a.type === "delete")
        return 1;
      if (b.type === "delete")
        return -1;
      return 0;
    });
    const creationMessages = messages.filter(isCreateObjectMessage);
    messages = messages.filter((m) => !isCreateObjectMessage(m));
    for (const creationMessage of creationMessages) {
      this._pendingCreationMessages.set(creationMessage.objectId, creationMessage);
    }
    while (this._pendingCreationMessages.size > 0) {
      const creationMessage = this._pendingCreationMessages.values().next().value;
      this.createNewTrackedObject(creationMessage, clientConnection);
    }
    for (const message of messages) {
      if (isChangeObjectMessage(message))
        this.handleChanges(message, clientConnection);
      else if (isDeleteObjectMessage(message))
        this.deleteTrackedObject(message, clientConnection);
      else if (isExecuteObjectMessage(message))
        await this.executeMethodAsync(message, clientConnection);
    }
    const result = this._currentClientApplyResult;
    this._currentClientApplyResult = { newTrackedObjects: [], methodExecuteResults: [] };
    return result;
  }
  getPropertyValue(property, clientConnection) {
    const { objectId, value, typeId } = property;
    if (typeId) {
      return this.deserializeValue(typeId, value, clientConnection);
    }
    if (objectId !== void 0 && objectId !== null) {
      let tracked = this._trackedObjectPool.get(objectId);
      if (!tracked) {
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
  findObjectOfType(constructor, objectId) {
    for (const tracked of this._trackedObjectPool.all) {
      if (tracked instanceof constructor) {
        const metaInfo = getObjectSyncMetaInfo(tracked);
        if (objectId !== void 0 && metaInfo.objectId !== objectId)
          continue;
        return tracked;
      }
    }
    return null;
  }
  findObjectsOfType(constructor) {
    const results = [];
    for (const tracked of this._trackedObjectPool.all) {
      if (tracked instanceof constructor) {
        results.push(tracked);
      }
    }
    return results;
  }
  get allTrackedObjects() {
    return Array.from(this._trackedObjectPool.all);
  }
  deleteTrackedObject(data, clientConnection) {
    if (!isDeleteObjectMessage(data))
      return;
    if (!this._trackedObjectPool.hasById(data.objectId)) {
      throw new Error(`Object with id ${data.objectId} is not being tracked`);
    }
    const tracked = this._trackedObjectPool.get(data.objectId);
    if (!invokeOnDelete(tracked, this, clientConnection))
      return;
    this._trackedObjectPool.deleteById(data.objectId);
    invokeOnDeleted(tracked, this, clientConnection);
  }
  constructObject(data, clientConnection) {
    if (this._trackedObjectPool.hasById(data.objectId)) {
      return;
    }
    let result = null;
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
        delete result[key];
      });
    }
    if (!result)
      return;
    const objectInfo = ensureObjectSyncMetaInfo({
      object: result,
      objectId: data.objectId,
      typeId: data.typeId
    });
    objectInfo.applicatorInfo = new ApplicatorObjectInfo(objectInfo, this);
    if (!this._trackedObjectPool.has(result)) {
      this._trackedObjectPool.add(result);
      this._currentClientApplyResult.newTrackedObjects.push(result);
    }
    return;
  }
  createResolvablePropertyInfos(unresolvedProperties, clientConnection) {
    const deletedProperties = /* @__PURE__ */ new Set();
    const properties = {
      deleteProperty(key) {
        deletedProperties.add(key);
      },
      get deletedProperties() {
        return Array.from(deletedProperties);
      }
    };
    Object.keys(unresolvedProperties).forEach((key) => {
      const propertyInfo = unresolvedProperties[key];
      let resolvedValue = void 0;
      let hasResolved = false;
      Object.defineProperty(properties, key, {
        get: () => {
          if (!hasResolved) {
            hasResolved = true;
            resolvedValue = this.getPropertyValue(propertyInfo, clientConnection);
          }
          return resolvedValue;
        }
      });
    });
    return properties;
  }
  createNewTrackedObject(data, clientConnection) {
    if (!isCreateObjectMessage(data))
      return;
    this._pendingCreationMessages.delete(data.objectId);
    this.constructObject(data, clientConnection);
    this.handleChanges(data, clientConnection);
  }
  handleChanges(data, clientConnection) {
    const isCreate = isCreateObjectMessage(data);
    const isChange = isChangeObjectMessage(data);
    if (!isCreate && !isChange)
      return;
    const tracked = this._trackedObjectPool.get(data.objectId);
    if (!tracked) {
      throw new Error(`Cannot find target with id ${data.objectId}`);
    }
    Object.keys(data.properties).forEach((key) => {
      if (!checkCanApplyProperty(tracked.constructor, tracked, key, false, clientConnection))
        return;
      const property = data.properties[key];
      const finalValue = this.getPropertyValue(property, clientConnection);
      const propertyInfo = getSyncPropertyInfo(tracked.constructor, key);
      if (propertyInfo)
        propertyInfo.isBeeingApplied = true;
      try {
        if (!invokeOnUpdateProperty(tracked, key, finalValue, isCreate, this, clientConnection))
          tracked[key] = finalValue;
      } finally {
        if (propertyInfo)
          propertyInfo.isBeeingApplied = false;
      }
    });
    if (isChange)
      invokeOnUpdated(tracked, data, this, clientConnection);
    else if (isCreate)
      invokeOnCreated(tracked, data, this, clientConnection);
  }
  async executeMethodAsync(data, clientConnection) {
    if (!isExecuteObjectMessage(data))
      return;
    const tracked = this._trackedObjectPool.get(data.objectId);
    if (!tracked) {
      throw new Error(`Cannot find target with id ${data.objectId}`);
    }
    if (!checkCanApplyProperty(tracked.constructor, tracked, data.method, true, clientConnection)) {
      this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result: null, status: "rejected", error: "Not allowed." });
      return;
    }
    if (typeof tracked[data.method] !== "function") {
      throw new Error(`Target with id ${data.objectId} has no method ${data.method}`);
    }
    const methodInfo = getSyncMethodInfo(tracked.constructor, data.method);
    const args = data.parameters.map((property) => this.getPropertyValue(property, clientConnection));
    let result;
    try {
      if (methodInfo)
        methodInfo.isBeeingApplied = true;
      result = tracked[data.method](...args);
    } catch (e) {
      this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result: null, status: "rejected", error: e });
      return;
    } finally {
      if (methodInfo)
        methodInfo.isBeeingApplied = false;
    }
    if (result && typeof result.then === "function" && typeof result.catch === "function") {
      const promiseHandlingType = getSyncMethodInfo(tracked.constructor, data.method)?.promiseHandlingType ?? "normal";
      const resolveNow = promiseHandlingType === "await";
      if (resolveNow) {
        try {
          const resolved = await result;
          this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result: resolved, status: "resolved", error: null });
        } catch (error) {
          this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result: null, status: "rejected", error });
        }
      } else {
        result.then((resolved) => {
          this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result: resolved, status: "resolved", error: null });
        }).catch((error) => {
          this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result: null, status: "rejected", error });
        });
      }
    } else {
      this._currentClientApplyResult.methodExecuteResults.push({ objectId: data.objectId, id: data.id, result, status: "resolved", error: null });
    }
  }
  deserializeValue(typeId, value, clientConnection) {
    const generator = this._typeSerializers.get(typeId) ?? this._nativeTypeSerializers.find((g) => g.typeId === typeId);
    if (!generator) {
      throw new Error(`No deserializer registered for typeId ${typeId}`);
    }
    if (generator.deserialize)
      return generator.deserialize(value, this, clientConnection);
    else
      return new generator.type(value);
  }
};
function isDeleteObjectMessage(change) {
  return change.type === "delete";
}
function isCreateObjectMessage(change) {
  return change.type === "create";
}
function isChangeObjectMessage(change) {
  return change.type === "change";
}
function isExecuteObjectMessage(change) {
  return change.type === "execute";
}

// build/tracker/decorators.js
var TRACKABLE_CONSTRUCTOR_INFO = Symbol("trackableConstructor");
var nothing = Symbol("nothing");
function syncProperty(settings) {
  settings ?? (settings = {});
  return function syncProperty2(target, context) {
    const trackableInfo = ensureTrackableConstructorInfo(context.metadata);
    const propertyInfo = {
      ...settings,
      isBeeingApplied: false
    };
    const propertyName = context.name;
    trackableInfo.trackedProperties.set(propertyName, propertyInfo);
    const result = {
      set(value) {
        const isBeeingApplied = propertyInfo.isBeeingApplied;
        propertyInfo.isBeeingApplied = false;
        target.set.call(this, value);
        if (isBeeingApplied || propertyInfo.mode === "none" || propertyInfo.mode === "applyOnly")
          return;
        const host = getObjectSyncMetaInfo(this)?.trackerInfo;
        if (host && checkCanTrackPropertyInfo(propertyInfo, this, propertyName, host)) {
          host.onPropertyChanged(context.name, value);
        }
      }
    };
    return result;
  };
}
function syncMethod(settings) {
  settings ?? (settings = {});
  return function syncMethod2(target, context) {
    const trackableInfo = ensureTrackableConstructorInfo(context.metadata);
    const methodInfo = {
      ...settings,
      isBeeingApplied: false
    };
    const methodName = context.name;
    trackableInfo.trackedMethods.set(methodName, methodInfo);
    const originalMethod = target;
    const func = function(...args) {
      const isBeeingApplied = methodInfo.isBeeingApplied;
      methodInfo.isBeeingApplied = false;
      const result = originalMethod.apply(this, args);
      if (isBeeingApplied || methodInfo.mode === "none" || methodInfo.mode === "applyOnly")
        return result;
      const hostInfo = getObjectSyncMetaInfo(this)?.trackerInfo;
      if (hostInfo && checkCanTrackPropertyInfo(methodInfo, this, methodName, hostInfo)) {
        hostInfo.onMethodExecute(context.name, args);
      }
      return result;
    };
    return func;
  };
}
function getTrackableTypeInfo(ctor) {
  const trackableInfo = ctor[Symbol.metadata]?.[TRACKABLE_CONSTRUCTOR_INFO];
  return trackableInfo ?? null;
}
function syncObject(settings) {
  return function syncObject2(target, context) {
    settings ?? (settings = {});
    settings.typeId ?? (settings.typeId = context.name);
    const trackableInfo = ensureTrackableConstructorInfo(context.metadata);
    trackableInfo.typeId = settings.typeId;
    trackableInfo.beforeSendToClient = settings.beforeSendToClient;
    if (settings.properties) {
      for (const [propertyKey, propertySettings] of Object.entries(settings.properties)) {
        trackableInfo.trackedProperties.set(propertyKey, {
          ...propertySettings,
          isBeeingApplied: false
        });
      }
    }
    if (settings.methods) {
      for (const [methodKey, methodSettings] of Object.entries(settings.methods)) {
        trackableInfo.trackedMethods.set(methodKey, {
          ...methodSettings,
          isBeeingApplied: false
        });
      }
    }
    allTypeGenerators.set(settings.typeId, settings.generator ?? target);
  };
}
function ensureTrackableConstructorInfo(metadata) {
  const oldTrackableInfo = metadata[TRACKABLE_CONSTRUCTOR_INFO] ?? {
    trackedProperties: /* @__PURE__ */ new Map(),
    trackedMethods: /* @__PURE__ */ new Map(),
    isAutoTrackable: false,
    beforeSendToClient: void 0
  };
  const newTrackableInfo = {
    trackedProperties: new Map(oldTrackableInfo.trackedProperties),
    trackedMethods: new Map(oldTrackableInfo.trackedMethods),
    typeId: oldTrackableInfo.typeId,
    beforeSendToClient: oldTrackableInfo.beforeSendToClient
  };
  metadata[TRACKABLE_CONSTRUCTOR_INFO] = newTrackableInfo;
  return newTrackableInfo;
}
function getSyncPropertyInfo(constructor, propertyKey) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return null;
  }
  const propertyInfo = constructorInfo.trackedProperties.get(propertyKey);
  return propertyInfo ?? null;
}
function getSyncMethodInfo(constructor, propertyKey) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return null;
  }
  const propertyInfo = constructorInfo.trackedMethods.get(propertyKey);
  return propertyInfo ?? null;
}
function checkCanApplyProperty(constructor, instance, propertyKey, isMethod, sourceClientConnection) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo)
    return false;
  const propertyInfo = isMethod ? constructorInfo.trackedMethods.get(propertyKey) : constructorInfo.trackedProperties.get(propertyKey);
  if (!propertyInfo)
    return false;
  if (propertyInfo.mode === "none" || propertyInfo.mode === "trackOnly")
    return;
  if (propertyInfo.canApply?.call(instance, { instance, key: propertyKey, sourceClientConnection }) === false)
    return false;
  return true;
}
function checkCanTrackPropertyInfo(propertyInfo, instance, propertyKey, info) {
  if (!propertyInfo) {
    return false;
  }
  if (propertyInfo.canTrack?.call(instance, { instance, key: propertyKey, info }) === false) {
    return false;
  }
  return true;
}
function beforeExecuteOnClient(constructor, instance, methodKey, args, destinationClientConnection) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return false;
  }
  const methodInfo = constructorInfo.trackedMethods.get(methodKey);
  if (!methodInfo) {
    return false;
  }
  if (methodInfo.beforeExecuteOnClient?.call(instance, { instance, key: methodKey, args, destinationClientConnection }) === false) {
    return false;
  }
  return true;
}
function beforeSendPropertyToClient(constructor, instance, propertyKey, value, destinationClientConnection) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return nothing;
  }
  const propertyInfo = constructorInfo.trackedProperties.get(propertyKey);
  if (!propertyInfo) {
    return nothing;
  }
  if (!propertyInfo.beforeSendToClient) {
    return value;
  }
  return propertyInfo.beforeSendToClient.call(instance, { instance, key: propertyKey, value, destinationClientConnection });
}
function beforeSendObjectToClient(constructor, instance, typeId, destinationClientConnection) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return nothing;
  }
  if (!constructorInfo.beforeSendToClient) {
    return typeId;
  }
  const result = constructorInfo.beforeSendToClient.call(instance, { instance, constructor, typeId, destinationClientConnection });
  if (result === null || result === void 0 || result === nothing) {
    return nothing;
  }
  if (typeof result === "string") {
    return result;
  }
  if (typeof result === "function") {
    const newConstructorInfo = getTrackableTypeInfo(result);
    if (newConstructorInfo && newConstructorInfo.typeId) {
      return newConstructorInfo.typeId;
    }
    throw new Error(`The constructor returned from beforeSendToClient does not have a typeId.`);
  }
  return typeId;
}

// build/shared/objectSyncMetaInfo.js
var objectSyncSymbol = Symbol("objectSync");
function getObjectSyncMetaInfo(target) {
  if (!target || typeof target !== "object")
    return void 0;
  if (typeof target === "function")
    return void 0;
  return target[objectSyncSymbol];
}
var nextObjectId = 1;
function createObjectId(objectIdPrefix) {
  return `${objectIdPrefix}${nextObjectId++}`;
}
function ensureObjectSyncMetaInfo(settings) {
  let metaInfo = getObjectSyncMetaInfo(settings.object);
  if (metaInfo)
    return metaInfo;
  if (!("objectId" in settings) && !("objectIdPrefix" in settings)) {
    throw new Error("objectIdPrefix must be provided when objectId is provided");
  }
  const typeId = settings.typeId ?? getTrackableTypeInfo(settings.object.constructor)?.typeId ?? settings.object.constructor.name;
  const objectId = settings.objectId ?? createObjectId(settings.objectIdPrefix);
  metaInfo = {
    objectId,
    typeId,
    object: settings.object
  };
  settings.object[objectSyncSymbol] = metaInfo;
  return metaInfo;
}
function getTrackerObjectInfo(obj) {
  return getObjectSyncMetaInfo(obj)?.trackerInfo ?? null;
}
function getApplicatorObjectInfo(obj) {
  return getObjectSyncMetaInfo(obj)?.applicatorInfo ?? null;
}

// build/shared/trackedObjectPool.js
var TrackedObjectPool = class {
  constructor() {
    __publicField(this, "_trackedObjectInfos", /* @__PURE__ */ new Map());
  }
  add(object) {
    const metaInfo = getObjectSyncMetaInfo(object);
    if (!metaInfo)
      throw new Error("Object is not trackable.");
    if (this.hasById(metaInfo?.objectId))
      return;
    this._trackedObjectInfos.set(metaInfo.objectId, metaInfo);
  }
  delete(object) {
    const metaInfo = getObjectSyncMetaInfo(object);
    if (!metaInfo)
      return false;
    return this._trackedObjectInfos.delete(metaInfo.objectId);
  }
  deleteById(objectId) {
    return this._trackedObjectInfos.delete(objectId);
  }
  get(objectId) {
    const metaInfo = this._trackedObjectInfos.get(objectId);
    return metaInfo?.object ?? null;
  }
  has(object) {
    const metaInfo = getObjectSyncMetaInfo(object);
    if (!metaInfo)
      return false;
    return this._trackedObjectInfos.has(metaInfo.objectId);
  }
  hasById(objectId) {
    return this._trackedObjectInfos.has(objectId);
  }
  get allMetaInfos() {
    const result = [];
    this._trackedObjectInfos.forEach((info) => result.push(info));
    return result;
  }
  get all() {
    const result = [];
    this._trackedObjectInfos.forEach((info) => result.push(info.object));
    return result;
  }
};

// build/tracker/interfaces.js
var onConvertedToTrackable = Symbol("onConvertedToTrackable");
var onTick = Symbol("onTick");
function hasOnConvertedToTrackable(obj) {
  return onConvertedToTrackable in obj;
}
function hasOnTick(obj) {
  return onTick in obj;
}
function invokeOnConvertedToTrackable(obj, info) {
  if (hasOnConvertedToTrackable(obj)) {
    obj[onConvertedToTrackable](info);
  }
}
function invokeOnTick(obj) {
  if (hasOnTick(obj)) {
    obj[onTick]();
  }
}

// build/shared/syncableArray.js
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
  function accept(f) {
    if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
    return f;
  }
  var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
  var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
  var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
  var _, done = false;
  for (var i = decorators.length - 1; i >= 0; i--) {
    var context = {};
    for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
    for (var p in contextIn.access) context.access[p] = contextIn.access[p];
    context.addInitializer = function(f) {
      if (done) throw new TypeError("Cannot add initializers after decoration has completed");
      extraInitializers.push(accept(f || null));
    };
    var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
    if (kind === "accessor") {
      if (result === void 0) continue;
      if (result === null || typeof result !== "object") throw new TypeError("Object expected");
      if (_ = accept(result.get)) descriptor.get = _;
      if (_ = accept(result.set)) descriptor.set = _;
      if (_ = accept(result.init)) initializers.unshift(_);
    } else if (_ = accept(result)) {
      if (kind === "field") initializers.unshift(_);
      else descriptor[key] = _;
    }
  }
  if (target) Object.defineProperty(target, contextIn.name, descriptor);
  done = true;
};
var __runInitializers = function(thisArg, initializers, value) {
  var useValue = arguments.length > 2;
  for (var i = 0; i < initializers.length; i++) {
    value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
  }
  return useValue ? value : void 0;
};
var SyncableArray = (() => {
  var _a;
  let _classDecorators = [syncObject({
    typeId: "SyncableArray",
    properties: {
      _changes: {},
      _creation: {}
    }
  })];
  let _classDescriptor;
  let _classExtraInitializers = [];
  let _classThis;
  var SyncableArray2 = (_a = class {
    constructor(initial = []) {
      __publicField(this, "_values", []);
      __publicField(this, "_changes", []);
      __publicField(this, "_creation", []);
      this.push(...initial);
    }
    get value() {
      return this._values;
    }
    set value(value) {
      this.clear();
      this.push(...value);
    }
    clear() {
      this.length = 0;
    }
    changeAt(index, value) {
      this._values[index] = value;
      this.onRemoved(index, [value]);
      this.onAdded(index, [value]);
      const hostObjectInfo = getTrackerObjectInfo(this);
      if (hostObjectInfo) {
        this._creation[index] = this.convertItemToPropertyInfo(hostObjectInfo, value);
        this.addChange({ start: index, deleteCount: 1, items: this.convertItemsToPropertyInfos(hostObjectInfo, [value]) });
      }
    }
    get length() {
      return this._values.length;
    }
    set length(value) {
      if (value < this._values.length) {
        this.splice(value, this._values.length - value);
      } else if (value > this._values.length) {
        this.push(...new globalThis.Array(value - this._values.length).fill(void 0));
      }
    }
    push(...items) {
      if (items.length === 0)
        return this._values.length;
      const startIndex = this._values.length;
      this._values.push(...items);
      const hostObjectInfo = getTrackerObjectInfo(this);
      if (hostObjectInfo) {
        this._creation.push(...this.convertItemsToPropertyInfos(hostObjectInfo, items));
        this.addChange({ start: startIndex, deleteCount: 0, items: this.convertItemsToPropertyInfos(hostObjectInfo, items) });
      }
      this.onAdded(startIndex, items);
      return this._values.length;
    }
    convertPropertyInfosToItems(items, client, clientConnection) {
      return items.map((item) => client.getPropertyValue(item, clientConnection));
    }
    splice(start, deleteCount, ...items) {
      deleteCount ?? (deleteCount = this._values.length - start);
      if (deleteCount === 0 && items.length === 0)
        return [];
      const removedItems = this._values.splice(start, deleteCount, ...items);
      if (removedItems.length > 0)
        this.onRemoved(start, removedItems);
      if (items.length > 0)
        this.onAdded(start, items);
      const hostObjectInfo = getTrackerObjectInfo(this);
      if (hostObjectInfo) {
        const convertedItems = this.convertItemsToPropertyInfos(hostObjectInfo, items);
        this._creation.splice(start, deleteCount, ...convertedItems);
        this.addChange({ start, deleteCount, items: convertedItems });
      }
      return removedItems;
    }
    addChange(pendingChange) {
      this.onPropertyChanged("_changes", this._changes);
      while (pendingChange) {
        const lastChange = this._changes[this._changes.length - 1];
        if (!lastChange) {
          this._changes.push(pendingChange);
          return;
        }
        if (lastChange.deleteCount === 0 && pendingChange.deleteCount === 0 && lastChange.start + lastChange.items.length === pendingChange.start) {
          lastChange.items.push(...pendingChange.items);
          pendingChange = this._changes.pop();
          continue;
        }
        if (lastChange.deleteCount === 0 && pendingChange.deleteCount > 0 && pendingChange.items.length === 0 && lastChange.start + lastChange.items.length === pendingChange.start + pendingChange.deleteCount && pendingChange.start >= lastChange.start) {
          const removeCount = pendingChange.deleteCount;
          const newLength = lastChange.items.length - removeCount;
          if (newLength > 0) {
            lastChange.items.length = newLength;
            pendingChange = this._changes.pop();
            continue;
          } else {
            this._changes.pop();
            pendingChange = pendingChange;
            continue;
          }
        }
        if (lastChange.deleteCount === 0 && pendingChange.deleteCount > 0 && pendingChange.items.length === 0 && pendingChange.start >= lastChange.start && pendingChange.start < lastChange.start + lastChange.items.length && pendingChange.start + pendingChange.deleteCount <= lastChange.start + lastChange.items.length) {
          const relativeStart = pendingChange.start - lastChange.start;
          lastChange.items.splice(relativeStart, pendingChange.deleteCount);
          pendingChange = this._changes.pop();
          continue;
        }
        this._changes.push(pendingChange);
        return;
      }
    }
    convertItemsToPropertyInfos(serverObjectInfo, items) {
      return items.map((item) => this.convertItemToPropertyInfo(serverObjectInfo, item));
    }
    convertItemToPropertyInfo(serverObjectInfo, item) {
      const metaInfo = serverObjectInfo.convertToTrackableObjectReference(item);
      const transformed = {
        value: item,
        objectId: metaInfo?.objectId,
        [isPropertyInfoSymbol]: true
      };
      return transformed;
    }
    [Symbol.iterator]() {
      return this._values[Symbol.iterator]();
    }
    onPropertyChanged(property, value) {
      const host = getTrackerObjectInfo(this);
      if (!host)
        return;
      host.onPropertyChanged(property, value);
    }
    [onTick]() {
      this._changes = [];
    }
    [onConvertedToTrackable](hostObjectInfo) {
      this._creation = [...this.convertItemsToPropertyInfos(hostObjectInfo, this._values)];
      this.onPropertyChanged("_creation", this._creation);
      this.onPropertyChanged("_changes", this._changes);
    }
    [onUpdateProperty](key, value, isForCreate, client, clientConnection) {
      if (isForCreate && key === "_creation") {
        this.value = this.convertPropertyInfosToItems(value, client, clientConnection);
      } else if (!isForCreate && key === "_changes") {
        this.applyTrackableArrayChanges(this._values, value, client, clientConnection);
      }
      return true;
    }
    applyTrackableArrayChanges(arr, changes, client, clientConnection) {
      for (const change of changes) {
        const newItems = this.convertPropertyInfosToItems(change.items, client, clientConnection);
        const removedItems = arr.splice(change.start, change.deleteCount, ...newItems);
        if (removedItems.length > 0)
          this.onRemoved(change.start, removedItems);
        if (change.items.length > 0)
          this.onAdded(change.start, newItems);
      }
      return arr;
    }
    toJSON() {
      return this._values;
    }
    toValue() {
      return this._values;
    }
    onRemoved(start, items) {
    }
    onAdded(start, items) {
    }
  }, _classThis = _a, (() => {
    const _metadata = typeof Symbol === "function" && Symbol.metadata ? /* @__PURE__ */ Object.create(null) : void 0;
    __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
    SyncableArray2 = _classThis = _classDescriptor.value;
    if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
    __runInitializers(_classThis, _classExtraInitializers);
  })(), _a);
  return SyncableArray2 = _classThis;
})();

// build/shared/eventEmitter.js
var EventEmitter = class {
  constructor() {
    __publicField(this, "_events", {});
  }
  on(event, callback) {
    if (!this._events[event])
      this._events[event] = [callback];
    else
      this._events[event].push(callback);
    this.onEventListenerAdded(event, callback);
  }
  once(event, callback) {
    const onceCallback = ((...args) => {
      this.off(event, onceCallback);
      callback(...args);
    });
    this.on(event, onceCallback);
  }
  off(event, callback) {
    if (!this._events[event])
      return;
    this._events[event] = this._events[event].filter((cb) => cb !== callback);
    this.onEventListenerRemoved(event, callback);
  }
  listenerCount(event, callback) {
    if (!this._events[event])
      return 0;
    if (!callback)
      return this._events[event].length;
    return this._events[event].filter((cb) => cb === callback).length;
  }
  emit(event, ...args) {
    if (!this._events[event])
      return;
    for (const callback of this._events[event]) {
      callback(...args);
    }
  }
  onEventListenerAdded(event, callback) {
  }
  onEventListenerRemoved(event, callback) {
  }
};

// build/shared/syncableObservableArray.js
var __esDecorate2 = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
  function accept(f) {
    if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
    return f;
  }
  var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
  var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
  var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
  var _, done = false;
  for (var i = decorators.length - 1; i >= 0; i--) {
    var context = {};
    for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
    for (var p in contextIn.access) context.access[p] = contextIn.access[p];
    context.addInitializer = function(f) {
      if (done) throw new TypeError("Cannot add initializers after decoration has completed");
      extraInitializers.push(accept(f || null));
    };
    var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
    if (kind === "accessor") {
      if (result === void 0) continue;
      if (result === null || typeof result !== "object") throw new TypeError("Object expected");
      if (_ = accept(result.get)) descriptor.get = _;
      if (_ = accept(result.set)) descriptor.set = _;
      if (_ = accept(result.init)) initializers.unshift(_);
    } else if (_ = accept(result)) {
      if (kind === "field") initializers.unshift(_);
      else descriptor[key] = _;
    }
  }
  if (target) Object.defineProperty(target, contextIn.name, descriptor);
  done = true;
};
var __runInitializers2 = function(thisArg, initializers, value) {
  var useValue = arguments.length > 2;
  for (var i = 0; i < initializers.length; i++) {
    value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
  }
  return useValue ? value : void 0;
};
var SyncableObservableArray = (() => {
  var _a;
  let _classDecorators = [syncObject({
    typeId: "SyncableObservableArray"
  })];
  let _classDescriptor;
  let _classExtraInitializers = [];
  let _classThis;
  let _classSuper = SyncableArray;
  var SyncableObservableArray2 = (_a = class extends _classSuper {
    constructor(initial = []) {
      super();
      __publicField(this, "_eventEmitter", new EventEmitter());
      this.push(...initial);
    }
    onRemoved(start, items) {
      this._eventEmitter.emit("removed", items, start);
    }
    onAdded(start, items) {
      this._eventEmitter.emit("added", items, start);
    }
    on(event, callback) {
      this._eventEmitter.on(event, callback);
    }
    once(event, callback) {
      this._eventEmitter.once(event, callback);
    }
    off(event, callback) {
      this._eventEmitter.off(event, callback);
    }
    listenerCount(event, callback) {
      return this._eventEmitter.listenerCount(event, callback);
    }
  }, _classThis = _a, (() => {
    const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
    __esDecorate2(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
    SyncableObservableArray2 = _classThis = _classDescriptor.value;
    if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
    __runInitializers2(_classThis, _classExtraInitializers);
  })(), _a);
  return SyncableObservableArray2 = _classThis;
})();

// build/shared/types.js
function isIterable(input) {
  return input && Symbol.iterator in Object(input) && typeof input !== "string";
}
function toIterable(input, preferSet = false) {
  if (isIterable(input)) {
    return input;
  }
  return preferSet ? /* @__PURE__ */ new Set([input]) : [input];
}
function forEachIterable(input, callback) {
  for (const item of toIterable(input)) {
    callback(item);
  }
}
function mapIterable(input, mapper) {
  const result = [];
  for (const item of toIterable(input)) {
    result.push(mapper(item));
  }
  return result;
}
function hasInIterable(input, expected) {
  if (input instanceof Set) {
    return input.has(expected);
  }
  for (const item of toIterable(input)) {
    if (item === expected) {
      return true;
    }
  }
  return false;
}

// build/tracker/trackerObjectInfo.js
var nextInvokeId = 0;
function isForClientConnection(clientConnection, filter) {
  let hasDesignation = filter.designations === void 0 || clientConnection.identity === void 0;
  if (!hasDesignation) {
    hasDesignation = hasInIterable(filter.designations, clientConnection.identity);
  }
  let hasClientConnection = filter.clients === void 0;
  if (!hasClientConnection) {
    hasClientConnection = hasInIterable(filter.clients, clientConnection);
  }
  return filter.isExclusive === (hasDesignation && hasClientConnection);
}
var ChangeTrackerObjectInfo = class _ChangeTrackerObjectInfo extends ObjectInfoBase {
  constructor(objectSyncMetaInfo, _tracker, _isRootObject, _objectIdPrefix) {
    super(objectSyncMetaInfo);
    __publicField(this, "_tracker");
    __publicField(this, "_isRootObject");
    __publicField(this, "_objectIdPrefix");
    __publicField(this, "_changeSet", {});
    __publicField(this, "_methodInvokeCalls", []);
    __publicField(this, "_pendingMethodInvokeCalls", /* @__PURE__ */ new Map());
    __publicField(this, "_clientFilters", null);
    __publicField(this, "_clients", /* @__PURE__ */ new Set());
    __publicField(this, "_invokeProxy", null);
    __publicField(this, "_lastMethodCallResult", null);
    this._tracker = _tracker;
    this._isRootObject = _isRootObject;
    this._objectIdPrefix = _objectIdPrefix;
  }
  static create(settings) {
    if (!settings.object || typeof settings.object !== "object")
      return null;
    const trackableTypeInfo = getTrackableTypeInfo(settings.object.constructor);
    if (!trackableTypeInfo)
      return null;
    const metaInfo = ensureObjectSyncMetaInfo(settings);
    if (!metaInfo) {
      throw new Error("Failed to create HostObjectInfo: unable to ensure ObjectSyncMetaInfo.");
    }
    if (metaInfo.trackerInfo)
      return metaInfo.trackerInfo;
    metaInfo.trackerInfo = new _ChangeTrackerObjectInfo(metaInfo, settings.owner, settings.isRoot, settings.objectIdPrefix);
    invokeOnConvertedToTrackable(metaInfo.object, metaInfo.trackerInfo);
    trackableTypeInfo.trackedProperties.forEach((propertyInfo, key) => {
      metaInfo.trackerInfo.onPropertyChanged(key, settings.object[key]);
    });
    return metaInfo.trackerInfo;
  }
  get tracker() {
    return this._tracker;
  }
  get clients() {
    return this._clients;
  }
  get isRootObject() {
    return this._isRootObject;
  }
  set isRootObject(value) {
    this._isRootObject = value;
  }
  get properties() {
    return this._changeSet;
  }
  get invokeProxy() {
    return this._invokeProxy ?? (this._invokeProxy = new Proxy(this.object, {
      get: (obj, prop) => {
        const value = obj[prop];
        if (typeof value === "function" && typeof prop === "string") {
          return (...args) => {
            return this.invoke(prop, ...args);
          };
        }
        return value;
      }
    }));
  }
  isForClient(client) {
    if (!this._clientFilters)
      return true;
    const filter = this._clientFilters;
    return isForClientConnection(client, filter);
  }
  removeClientRestrictions() {
    this._clientFilters = null;
  }
  setClientRestriction(filter) {
    this._clientFilters = {
      clients: filter.clients ? toIterable(filter.clients, true) : void 0,
      designations: filter.designations ? toIterable(filter.designations, true) : void 0,
      isExclusive: filter.isExclusive ?? true
    };
  }
  onPropertyChanged(key, value) {
    let current = this._changeSet[key];
    if (!current) {
      current = { hasPendingChanges: true, value };
      this._changeSet[key] = current;
      return;
    }
    if (current.value === value)
      return;
    current.value = value;
    current.hasPendingChanges = true;
  }
  createPropertyInfo(value) {
    const trackable = this.convertToTrackableObjectReference(value);
    const paramInfo = {
      value,
      objectId: trackable?.objectSyncMetaInfo.objectId,
      [isPropertyInfoSymbol]: true
    };
    return paramInfo;
  }
  onMethodExecute(method, parameters) {
    const message = {
      type: "execute",
      id: nextInvokeId++,
      objectId: this.objectId,
      parameters,
      method
    };
    this._methodInvokeCalls.push(message);
    let onRemainingClientsResolved;
    const result = new Promise((resolve) => {
      onRemainingClientsResolved = resolve;
    });
    this._pendingMethodInvokeCalls.set(message.id, {
      id: message.id,
      resultByClient: /* @__PURE__ */ new Map(),
      remainingClients: [],
      result,
      onRemainingClientsResolved
    });
    this._lastMethodCallResult = result;
    return result;
  }
  getInvokeResults(method) {
    const result = this._lastMethodCallResult;
    this._lastMethodCallResult = null;
    return result;
  }
  invoke(method, ...args) {
    const hostResult = this.object[method](...args);
    const clientResults = this.getInvokeResults(method);
    return { clientResults, hostResult };
  }
  onClientMethodExecuteResultReceived(methodExecuteResult, client) {
    const pendingCall = this._pendingMethodInvokeCalls.get(methodExecuteResult.id);
    if (!pendingCall)
      return;
    if (this.clients.has(client)) {
      pendingCall.resultByClient.set(client, new Promise((resolve, reject) => {
        if (methodExecuteResult.status === "resolved") {
          resolve(methodExecuteResult.result);
        } else {
          reject(methodExecuteResult.error);
        }
      }));
    }
    pendingCall.remainingClients = pendingCall.remainingClients.filter((c) => c !== client);
    if (pendingCall.remainingClients.length === 0) {
      this._pendingMethodInvokeCalls.delete(methodExecuteResult.id);
      pendingCall.onRemainingClientsResolved(pendingCall.resultByClient);
    }
  }
  convertToTrackableObjectReference(target) {
    if (target && typeof target === "object") {
      return _ChangeTrackerObjectInfo.create({
        object: target,
        isRoot: false,
        objectIdPrefix: this._objectIdPrefix,
        owner: this.tracker
      });
    }
    return null;
  }
  getCreateMessage(client) {
    const typeIdOrNothing = beforeSendObjectToClient(this.object.constructor, this.object, this.typeId, client);
    if (typeIdOrNothing === nothing)
      return null;
    const typeId = typeIdOrNothing;
    const result = {
      type: "create",
      objectId: this.objectId,
      typeId,
      properties: this.getProperties(client, false)
    };
    return result;
  }
  getDeleteMessage() {
    const result = {
      type: "delete",
      objectId: this.objectId
    };
    return result;
  }
  onClientRemoved(clientConnection) {
    this.clients.delete(clientConnection);
    this.cancelPendingMethodCalls(clientConnection);
  }
  cancelPendingMethodCalls(clientConnection) {
    this._pendingMethodInvokeCalls.forEach((pendingCall) => {
      pendingCall.remainingClients.forEach((client) => {
        if (clientConnection && client !== clientConnection)
          return;
        this.onClientMethodExecuteResultReceived({
          id: pendingCall.id,
          status: "rejected",
          error: new Error("Object deleted before method could be executed"),
          objectId: this.objectId,
          result: void 0
        }, client);
      });
    });
  }
  getChangeMessage(client) {
    if (!this.clients.has(client)) {
      return null;
    }
    const properties = this.getProperties(client, true);
    if (Object.keys(properties).length === 0)
      return null;
    const result = {
      type: "change",
      objectId: this.objectId,
      properties
    };
    return result;
  }
  getExecuteMessages(client) {
    const result = [];
    if (!this.clients.has(client)) {
      return result;
    }
    for (const methodExecuteCall of this._methodInvokeCalls) {
      const args = methodExecuteCall.parameters.slice();
      if (beforeExecuteOnClient(this.object.constructor, this.object, methodExecuteCall.method, args, client) === false) {
        continue;
      }
      result.push({
        ...methodExecuteCall,
        parameters: args.map((arg) => this.createPropertyInfo(arg))
      });
    }
    return result;
  }
  getProperties(client, includeChangedOnly) {
    const result = {};
    Object.keys(this._changeSet).forEach((key) => {
      let propertyStateInfo = this._changeSet[key];
      if (includeChangedOnly && !propertyStateInfo.hasPendingChanges)
        return;
      const finalValue = beforeSendPropertyToClient(this.object.constructor, this.object, key, propertyStateInfo.value, client);
      if (finalValue === nothing)
        return;
      const propertyInfo = this.createPropertyInfo(finalValue);
      const clientPropertyInfo = this.serializePropertyInfo(key, propertyInfo, client);
      if (clientPropertyInfo)
        result[key] = clientPropertyInfo;
    });
    return result;
  }
  serializePropertyInfo(key, propertyInfo, client) {
    let clientPropertyInfo = {
      objectId: propertyInfo.objectId,
      value: propertyInfo.value,
      [isPropertyInfoSymbol]: true
    };
    if (propertyInfo.objectId === void 0 && propertyInfo.objectId === null) {
      delete clientPropertyInfo.objectId;
    }
    if (clientPropertyInfo.value && clientPropertyInfo.objectId === void 0 && typeof clientPropertyInfo.value === "object") {
      const serializedValue = this.serializeValue(clientPropertyInfo.value);
      if (serializedValue === null) {
        clientPropertyInfo.value = clientPropertyInfo.value;
      } else {
        clientPropertyInfo.value = serializedValue.value;
        clientPropertyInfo.typeId = serializedValue.typeId;
      }
    }
    return clientPropertyInfo;
  }
  serializeValue(value) {
    return this.tracker.serializeValue(value, this);
  }
  tick() {
    Object.keys(this._changeSet).forEach((key) => {
      const propertyInfo = this._changeSet[key];
      propertyInfo.hasPendingChanges = false;
    });
    this._methodInvokeCalls.length = 0;
    invokeOnTick(this.objectSyncMetaInfo.object);
  }
};

// build/tracker/tracker.js
var ObjectChangeTracker = class {
  constructor(settings) {
    __publicField(this, "_trackedObjectPool");
    __publicField(this, "_clients", /* @__PURE__ */ new Set());
    __publicField(this, "_serializers", /* @__PURE__ */ new Map());
    __publicField(this, "_nativeTypeSerializers", []);
    __publicField(this, "_settings");
    this._settings = {
      identity: settings.identity,
      objectIdPrefix: settings.objectIdPrefix
    };
    this._trackedObjectPool = settings.objectPool;
    settings.typeSerializers.forEach((gen, typeId) => {
      const serializer = gen;
      serializer.typeId = serializer.typeId ?? typeId;
      this.registerSerializer(serializer);
    });
    this._nativeTypeSerializers = settings.nativeTypeSerializers;
  }
  get settings() {
    return this._settings;
  }
  registerSerializer(serializer) {
    if (this._serializers.has(serializer.type)) {
      throw new Error(`Serializer for typeId ${serializer.typeId} is already registered`);
    }
    this._serializers.set(serializer.type, serializer);
  }
  get identity() {
    return this._settings.identity;
  }
  get allTrackedObjects() {
    return this._trackedObjectPool.all;
  }
  registerClient(settings) {
    const clientToken = JSON.parse(JSON.stringify(settings));
    this._clients.add(clientToken);
    return clientToken;
  }
  removeClient(client) {
    if (!this._clients.has(client)) {
      throw new Error("Unknown client token");
    }
    this._trackedObjectPool.all.forEach((obj) => {
      const hostObjectInfo = getTrackerObjectInfo(obj);
      hostObjectInfo.onClientRemoved(client);
    });
    this._clients.delete(client);
  }
  setClientRestriction(obj, filter) {
    const tracked = getTrackerObjectInfo(obj);
    if (!tracked)
      throw new Error("Object is not tracked");
    tracked.setClientRestriction(filter);
  }
  track(target, trackSettings) {
    this.trackInternal(target, trackSettings);
  }
  trackInternal(target, trackSettings) {
    if (!target)
      return null;
    const isRoot = trackSettings?.isRoot !== false;
    let hostObjectInfo = getTrackerObjectInfo(target);
    if (!hostObjectInfo) {
      const creationSettings = {
        objectId: trackSettings?.objectId,
        isRoot,
        object: target,
        objectIdPrefix: this._settings.objectIdPrefix,
        owner: this
      };
      hostObjectInfo = getTrackerObjectInfo(target) ?? ChangeTrackerObjectInfo.create(creationSettings);
      if (!hostObjectInfo)
        return null;
      if (!this._trackedObjectPool.has(target))
        this._trackedObjectPool.add(target);
      if (trackSettings?.clientVisibility) {
        this.setClientRestriction(target, trackSettings.clientVisibility);
      }
    } else {
      if (!this._trackedObjectPool.has(target))
        this._trackedObjectPool.add(target);
    }
    if (trackSettings?.knownClients) {
      const clients = hostObjectInfo.clients;
      if (clients) {
        forEachIterable(trackSettings.knownClients, (client) => {
          clients.add(client);
        });
      }
    }
    return hostObjectInfo;
  }
  untrack(target) {
    this.untrackInternal(target, true);
  }
  untrackInternal(target, throwWhenNotTracked) {
    const hostObjectInfo = getTrackerObjectInfo(target);
    if (!this._trackedObjectPool.has(target) || !hostObjectInfo) {
      if (throwWhenNotTracked) {
        throw new Error("Object is not tracked");
      }
      return false;
    }
    hostObjectInfo.isRootObject = false;
    return true;
  }
  getMessages(clientOrClients) {
    clientOrClients ?? (clientOrClients = this._clients);
    const result = /* @__PURE__ */ new Map();
    forEachIterable(clientOrClients, (client) => {
      const initialTrackedObjects = this._trackedObjectPool.allMetaInfos.filter((o) => o.trackerInfo?.isRootObject).map((o) => o.object);
      const allTrackedObjectsForClient = this._trackedObjectPool.allMetaInfos.filter((o) => o.trackerInfo?.clients.has(client)).map((o) => o.object);
      const objectsToVisit = /* @__PURE__ */ new Set([...initialTrackedObjects]);
      let messages = [];
      for (const obj of objectsToVisit) {
        this.gatherMessagesForObjectGraph({
          object: obj,
          client,
          objectsToVisit,
          messages
        });
      }
      const noLongerTrackedByClient = allTrackedObjectsForClient.filter((o) => {
        if (objectsToVisit.has(o))
          return false;
        return true;
      });
      for (const obj of noLongerTrackedByClient) {
        const hostObjectInfo = getTrackerObjectInfo(obj);
        if (!hostObjectInfo)
          continue;
        hostObjectInfo.onClientRemoved(client);
        messages.push(hostObjectInfo.getDeleteMessage());
      }
      result.set(client, messages);
    });
    return result;
  }
  gatherMessagesForObjectGraph(args) {
    const hostObjectInfo = getTrackerObjectInfo(args.object);
    if (!hostObjectInfo)
      return;
    if (!hostObjectInfo?.isForClient(args.client))
      return;
    const isKnownToClient = hostObjectInfo.clients.has(args.client);
    const subMessages = [];
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
    const executeMessages = hostObjectInfo.getExecuteMessages(args.client);
    subMessages.push(...executeMessages);
    args.messages.push(...subMessages);
    for (const message of subMessages) {
      this.gatherSubTrackablesForGraphFromMessage(message, args);
    }
  }
  gatherSubTrackablesForGraphFromMessage(message, args) {
    let valuesToScan = [];
    if (message.type === "create" || message.type === "change") {
      const properties = message.properties;
      Object.values(properties).map((propertyInfo) => {
        if (propertyInfo)
          valuesToScan.push(propertyInfo);
      });
    } else if (message.type === "execute") {
      const parameters = message.parameters;
      Object.values(parameters).map((parameterInfo) => {
        if (parameterInfo)
          valuesToScan.push(parameterInfo);
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
  gatherSubTrackablesForGraphFromValue(data, args, visitedValues = /* @__PURE__ */ new Set()) {
    if (data === void 0 || data === null || typeof data !== "object" || visitedValues.has(data))
      return;
    visitedValues.add(data);
    if (isPropertyInfo(data)) {
      const isTrackable = data.objectId && data.value !== void 0;
      const isUntrackableObjectOrArray = !isTrackable && data.value && typeof data.value === "object";
      if (isTrackable) {
        this.trackInternal(data.value, { isRoot: false });
        args.objectsToVisit.add(data.value);
        delete data.value;
      } else if (isUntrackableObjectOrArray) {
        this.gatherSubTrackablesForGraphFromValue(data.value, args, visitedValues);
      }
    } else if (Array.isArray(data)) {
      data.forEach((value) => {
        if (!value || typeof value !== "object")
          return;
        this.gatherSubTrackablesForGraphFromValue(value, args, visitedValues);
      });
    } else {
      Object.keys(data).forEach((key) => {
        const value = data[key];
        if (!value || typeof value !== "object")
          return;
        this.gatherSubTrackablesForGraphFromValue(value, args, visitedValues);
      });
    }
  }
  applyClientMethodInvokeResults(client, methodExecuteResults) {
    for (const result of methodExecuteResults) {
      const tracked = this._trackedObjectPool.get(result.objectId);
      if (!tracked)
        continue;
      const hostObjectInfo = getTrackerObjectInfo(tracked);
      hostObjectInfo?.onClientMethodExecuteResultReceived(result, client);
    }
  }
  tick() {
    this._trackedObjectPool.allMetaInfos.forEach((meta) => {
      const hostObjectInfo = meta.trackerInfo;
      if (!hostObjectInfo)
        return;
      if (!hostObjectInfo.isRootObject && hostObjectInfo.clients.size === 0) {
        meta.trackerInfo?.onClientRemoved;
        this._trackedObjectPool.deleteById(meta.objectId);
        return;
      }
      hostObjectInfo.tick();
    });
  }
  serializeValue(value, trackerInfo) {
    let serializer = this._serializers.get(value.constructor) ?? this._nativeTypeSerializers.find((g) => value instanceof g.type);
    if (!serializer) {
      return null;
    }
    return {
      value: serializer.serialize ? serializer.serialize(value, trackerInfo) : "toJSON" in value && typeof value.toJSON === "function" ? value.toJSON() : "toValue" in value && typeof value.toValue === "function" ? value.toValue() : value,
      typeId: serializer.typeId
    };
  }
};

// build/shared/nativeTypeGenerators.js
var nativeArraySerializer = {
  type: Array,
  typeId: "<NativeArray>",
  serialize(instance, trackerInfo) {
    return mapIterable(instance, (item) => {
      const propertyInfo = trackerInfo.createPropertyInfo(item);
      return propertyInfo;
    });
  },
  deserialize(value, applicator, clientConnection) {
    return value.map((item) => {
      return applicator.getPropertyValue(item, clientConnection);
    });
  }
};
var nativeMapSerializer = {
  type: Map,
  typeId: "<NativeMap>",
  serialize(instance, trackerInfo) {
    const result = {};
    for (const [key, value] of instance.entries()) {
      const propertyInfo = trackerInfo.createPropertyInfo(value);
      result[key] = propertyInfo;
    }
    return result;
  },
  deserialize(value, applicator, clientConnection) {
    const result = /* @__PURE__ */ new Map();
    for (const [key, item] of Object.entries(value)) {
      result.set(key, applicator.getPropertyValue(item, clientConnection));
    }
    return result;
  }
};
var nativeSetSerializer = {
  type: Set,
  typeId: "<NativeSet>",
  serialize(instance, trackerInfo) {
    const result = [];
    for (const value of instance.values()) {
      const propertyInfo = trackerInfo.createPropertyInfo(value);
      result.push(propertyInfo);
    }
    return result;
  },
  deserialize(value, applicator, clientConnection) {
    const result = /* @__PURE__ */ new Set();
    for (const item of value) {
      result.add(applicator.getPropertyValue(item, clientConnection));
    }
    return result;
  }
};
var nativeObjectSerializer = {
  type: Object,
  typeId: "<NativeObject>",
  serialize(instance, trackerInfo) {
    const result = {};
    for (const [key, value] of Object.entries(instance)) {
      const propertyInfo = trackerInfo.createPropertyInfo(value);
      result[key] = propertyInfo;
    }
    return result;
  },
  deserialize(value, applicator, clientConnection) {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = applicator.getPropertyValue(item, clientConnection);
    }
    return result;
  }
};
var nativeTypeSerializers = [nativeSetSerializer, nativeMapSerializer, nativeArraySerializer, nativeObjectSerializer];

// build/objectSync/objectSync.js
var ObjectSync = class {
  constructor(settings) {
    __publicField(this, "_tracker");
    __publicField(this, "_applicator");
    __publicField(this, "_settings");
    __publicField(this, "_objectPool");
    this._settings = {
      identity: settings.identity,
      objectIdPrefix: settings.objectIdPrefix ?? `${settings.identity}-${Date.now()}-`,
      typeGenerators: /* @__PURE__ */ new Map(),
      typeSerializers: /* @__PURE__ */ new Map(),
      nativeTypeSerializers: settings.nativeTypeSerializers ?? nativeTypeSerializers
    };
    if (Array.isArray(settings.typeGenerators)) {
      for (const constructor of settings.typeGenerators) {
        const trackableTypeInfo = getTrackableTypeInfo(constructor);
        this._settings.typeGenerators.set(trackableTypeInfo?.typeId ?? constructor.name, constructor);
      }
    } else if (settings.typeGenerators)
      this._settings.typeGenerators = settings.typeGenerators;
    else
      this._settings.typeGenerators = new Map(allTypeGenerators);
    if (Array.isArray(settings.typeSerializers)) {
      for (const serializer of settings.typeSerializers) {
        this._settings.typeSerializers.set(serializer.typeId ?? serializer.type.name, serializer);
      }
    } else if (settings.typeSerializers)
      this._settings.typeSerializers = settings.typeSerializers;
    this._objectPool = new TrackedObjectPool();
    this._tracker = new ObjectChangeTracker({
      objectPool: this._objectPool,
      ...this._settings
    });
    this._applicator = new ObjectChangeApplicator({
      objectPool: this._objectPool,
      ...this._settings
    });
  }
  getMessages(clientOrClientsOrCallTick, callTick = true) {
    let result;
    let clients;
    if (typeof clientOrClientsOrCallTick === "boolean" || clientOrClientsOrCallTick === void 0) {
      clients = void 0;
      callTick = clientOrClientsOrCallTick ?? true;
    } else if (!isIterable(clientOrClientsOrCallTick)) {
      clients = clientOrClientsOrCallTick;
    }
    result = this._tracker.getMessages(clients);
    if (callTick)
      this._tracker.tick();
    if (clients === void 0 || isIterable(clients))
      return result;
    return result.get(clients);
  }
  tick() {
    this._tracker.tick();
  }
  applyAsync(messages, clientConnection) {
    return this._applicator.applyAsync(messages, clientConnection);
  }
  applyClientMethodInvokeResults(resultsByClient) {
    for (const [clientToken, results] of resultsByClient) {
      this.applyClientMethodInvokeResultsFromClient(clientToken, results);
    }
  }
  applyClientMethodInvokeResultsFromClient(clientConnection, results) {
    this._tracker.applyClientMethodInvokeResults(clientConnection, results);
  }
  async applyMessagesAsync(messagesByClient) {
    const resultsByClient = /* @__PURE__ */ new Map();
    for (const [clientConnection, messages] of messagesByClient) {
      const methodExecuteResults = await this.applyMessagesFromClientAsync(clientConnection, messages);
      resultsByClient.set(clientConnection, methodExecuteResults);
    }
    return resultsByClient;
  }
  async applyMessagesFromClientAsync(clientConnection, messages) {
    const results = await this._applicator.applyAsync(messages, clientConnection);
    for (const obj of results.newTrackedObjects) {
      this._tracker.track(obj, {
        knownClients: clientConnection
      });
    }
    return results.methodExecuteResults;
  }
  async exchangeMessagesAsync(sendToClientAsync, errorHandler) {
    const messages = this.getMessages();
    const resultsByClient = /* @__PURE__ */ new Map();
    const allPromises = [];
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
  async exchangeMessagesBulkAsync(sendToClientsAsync, errorHandler) {
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
  registerSerializer(serializer) {
    this._tracker.registerSerializer(serializer);
  }
  get identity() {
    return this._settings.identity;
  }
  get allTrackedObjects() {
    return this._tracker.allTrackedObjects;
  }
  registerClient(settings) {
    return this._tracker.registerClient(settings);
  }
  removeClient(client) {
    this._tracker.removeClient(client);
  }
  track(target, trackSettings) {
    this._tracker.track(target, trackSettings);
  }
  untrack(target) {
    this._tracker.untrack(target);
  }
  setClientRestriction(obj, filter) {
    this._tracker.setClientRestriction(obj, filter);
  }
  registerGenerator(typeId, generator) {
    this._applicator.registerGenerator(typeId, generator);
  }
  findObjectOfType(constructor, objectId) {
    return this._applicator.findObjectOfType(constructor, objectId);
  }
  findObjectsOfType(constructor) {
    return this._applicator.findObjectsOfType(constructor);
  }
  getInvokeProxy(target) {
    if (!this._objectPool.has(target)) {
      this._tracker.track(target, { isRoot: false });
    }
    const meta = getTrackerObjectInfo(target);
    if (!meta) {
      throw new Error("Target object is not tracked and cannot be proxied.");
    }
    return meta.invokeProxy;
  }
  invoke(target, method, ...args) {
    if (!this._objectPool.has(target)) {
      this._tracker.track(target, { isRoot: false });
    }
    const meta = getTrackerObjectInfo(target);
    if (!meta) {
      throw new Error("Target object is not tracked and cannot be proxied.");
    }
    return meta.invoke(method, ...args);
  }
};
export {
  ChangeTrackerObjectInfo,
  ObjectChangeApplicator,
  ObjectChangeTracker,
  ObjectSync,
  SyncableArray,
  SyncableObservableArray,
  TrackedObjectPool,
  allTypeGenerators,
  getApplicatorObjectInfo,
  getObjectSyncMetaInfo,
  getTrackerObjectInfo,
  nothing,
  onCreated,
  onDelete,
  onDeleted,
  onUpdateProperty,
  onUpdated,
  syncMethod,
  syncObject,
  syncProperty
};
//# sourceMappingURL=index.js.map
