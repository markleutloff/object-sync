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

// build/shared/objectSyncMetaInfo.js
var objectSyncSymbol = Symbol("objectSync");
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
  const typeId = settings.typeId ?? settings.object.constructor.name;
  const objectId = settings.objectId ?? createObjectId(settings.objectIdPrefix);
  metaInfo = {
    objectId,
    typeId,
    object: settings.object
  };
  settings.object[objectSyncSymbol] = metaInfo;
  return metaInfo;
}
function getHostObjectInfo(obj) {
  return getObjectSyncMetaInfo(obj)?.host ?? null;
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

// build/client/trackableTarget.js
var onCreated = Symbol("onCreated");
var onUpdated = Symbol("onUpdated");
var onUpdateProperty = Symbol("onUpdateProperty");
var onDeleted = Symbol("onDeleted");
function hasOnCreated(obj) {
  return onCreated in obj;
}
function hasOnDeleted(obj) {
  return onDeleted in obj;
}
function hasOnUpdated(obj) {
  return onUpdated in obj;
}
function hasOnUpdateProperty(obj) {
  return onUpdateProperty in obj;
}
function invokeOnCreated(obj, changes) {
  if (hasOnCreated(obj)) {
    obj[onCreated](changes);
  }
}
function invokeOnUpdated(obj, changes) {
  if (hasOnUpdated(obj)) {
    obj[onUpdated](changes);
  }
}
function invokeOnDeleted(obj) {
  if (hasOnDeleted(obj)) {
    obj[onDeleted]();
  }
}
function invokeOnUpdateProperty(obj, key, value, isForCreate, client) {
  if (hasOnUpdateProperty(obj)) {
    return obj[onUpdateProperty](key, value, isForCreate, client);
  }
  return false;
}

// build/client/client.js
var defaultConstructorsByTypeId = /* @__PURE__ */ new Map();
var defaultGeneratorsByTypeId = /* @__PURE__ */ new Map();
var nextClientId = 0;
var ObjectSyncClient = class {
  constructor(_settings = {}) {
    __publicField(this, "_settings");
    __publicField(this, "_trackedObjectPool");
    __publicField(this, "_typeIdToConstructor", /* @__PURE__ */ new Map());
    __publicField(this, "_typeIdToGenerator", /* @__PURE__ */ new Map());
    __publicField(this, "_pendingCreationMessages", /* @__PURE__ */ new Map());
    __publicField(this, "_currentClientApplyResult", { newTrackedObjects: [], methodExecuteResults: [] });
    __publicField(this, "_clientId");
    this._settings = _settings;
    this._clientId = this._settings.clientId ?? nextClientId++;
    this._trackedObjectPool = this._settings.objectPool ?? new TrackedObjectPool();
    defaultConstructorsByTypeId.forEach((ctor, typeId) => this.registerConstructor(typeId, ctor));
    defaultGeneratorsByTypeId.forEach((gen, typeId) => this.registerGenerator(typeId, gen));
  }
  get clientId() {
    return this._clientId;
  }
  registerConstructorOrGenerator(typeId, constructorOrGenerator) {
    if (typeof constructorOrGenerator === "function" && constructorOrGenerator.prototype) {
      this.registerConstructor(typeId, constructorOrGenerator);
    } else {
      this.registerGenerator(typeId, constructorOrGenerator);
    }
  }
  registerConstructor(typeId, constructor) {
    if (this._typeIdToConstructor.has(typeId)) {
      throw new Error(`Constructor for typeId ${typeId} is already registered`);
    }
    this._typeIdToConstructor.set(typeId, constructor);
  }
  registerGenerator(typeId, generator) {
    if (this._typeIdToGenerator.has(typeId)) {
      throw new Error(`Generator for typeId ${typeId} is already registered`);
    }
    this._typeIdToGenerator.set(typeId, generator);
  }
  apply(messages) {
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
      this.createNewTrackedObject(creationMessage);
    }
    messages.forEach((message) => {
      if (isChangeObjectMessage(message))
        this.handleChanges(message);
      else if (isDeleteObjectMessage(message))
        this.deleteTrackedObject(message);
      else if (isExecuteObjectMessage(message))
        this.executeMethod(message);
    });
    const result = this._currentClientApplyResult;
    this._currentClientApplyResult = { newTrackedObjects: [], methodExecuteResults: [] };
    return result;
  }
  /**
   * Resolves a property value, returning the tracked object if objectId is present, or the value otherwise.
   * If the object is not yet tracked, attempts to create it from pending messages.
   */
  getPropertyValue(property) {
    const { objectId, value } = property;
    if (objectId !== void 0 && objectId !== null) {
      let tracked = this._trackedObjectPool.get(objectId);
      if (!tracked) {
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
  findTrackedObject(constructor, objectId) {
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
  get allTrackedObjects() {
    return Array.from(this._trackedObjectPool.all);
  }
  deleteTrackedObject(data) {
    if (!isDeleteObjectMessage(data))
      return;
    if (!this._trackedObjectPool.hasById(data.objectId)) {
      throw new Error(`Object with id ${data.objectId} is not being tracked`);
    }
    const tracked = this._trackedObjectPool.get(data.objectId);
    this._trackedObjectPool.deleteById(data.objectId);
    invokeOnDeleted(tracked);
  }
  constructObject(data) {
    if (this._trackedObjectPool.hasById(data.objectId)) {
      return;
    }
    const constructor = this._typeIdToConstructor.get(data.typeId);
    let result;
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
        delete result[key];
      });
    }
    if (!result)
      return;
    ensureObjectSyncMetaInfo({
      object: result,
      objectId: data.objectId,
      typeId: data.typeId
    });
    if (!this._trackedObjectPool.has(result)) {
      this._trackedObjectPool.add(result);
      this._currentClientApplyResult.newTrackedObjects.push(result);
    }
    return;
  }
  createResolvablePropertyInfos(unresolvedProperties) {
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
            resolvedValue = this.getPropertyValue(propertyInfo);
          }
          return resolvedValue;
        }
      });
    });
    return properties;
  }
  createNewTrackedObject(data) {
    if (!isCreateObjectMessage(data))
      return;
    this._pendingCreationMessages.delete(data.objectId);
    this.constructObject(data);
    this.handleChanges(data);
  }
  handleChanges(data) {
    const isCreate = isCreateObjectMessage(data);
    const isChange = isChangeObjectMessage(data);
    if (!isCreate && !isChange)
      return;
    const tracked = this._trackedObjectPool.get(data.objectId);
    if (!tracked) {
      throw new Error(`Cannot find target with id ${data.objectId}`);
    }
    Object.keys(data.properties).forEach((key) => {
      if (!checkCanUseProperty(tracked.constructor, key, this._settings.designation))
        return;
      const property = data.properties[key];
      const finalValue = this.getPropertyValue(property);
      if (!invokeOnUpdateProperty(tracked, key, finalValue, isCreate, this))
        tracked[key] = finalValue;
    });
    if (isChange)
      invokeOnUpdated(tracked, data);
    else if (isCreate)
      invokeOnCreated(tracked, data);
  }
  executeMethod(data) {
    if (!isExecuteObjectMessage(data))
      return;
    const tracked = this._trackedObjectPool.get(data.objectId);
    if (!tracked) {
      throw new Error(`Cannot find target with id ${data.objectId}`);
    }
    if (!checkCanUseMethod(tracked.constructor, data.method, this._settings.designation)) {
      this._currentClientApplyResult.methodExecuteResults.push({ id: data.id, result: null, status: "sync", error: "Not allowed." });
      return;
    }
    if (typeof tracked[data.method] !== "function") {
      throw new Error(`Target with id ${data.objectId} has no method ${data.method}`);
    }
    const args = data.parameters.map((property) => this.getPropertyValue(property));
    const result = tracked[data.method](...args);
    if (result && typeof result.then === "function" && typeof result.catch === "function") {
      result.then((resolved) => {
        this._currentClientApplyResult.methodExecuteResults.push({ id: data.id, result: resolved, status: "resolved", error: null });
      }).catch((error) => {
        this._currentClientApplyResult.methodExecuteResults.push({ id: data.id, result: null, status: "rejected", error });
      });
    } else {
      this._currentClientApplyResult.methodExecuteResults.push({ id: data.id, result, status: "sync", error: null });
    }
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

// build/shared/types.js
function toIterable(input, preferSet = false) {
  if (Symbol.iterator in Object(input) && typeof input !== "string") {
    return input;
  }
  return preferSet ? /* @__PURE__ */ new Set([input]) : [input];
}
function forEachIterable(input, callback) {
  for (const item of toIterable(input)) {
    callback(item);
  }
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

// build/host/decorators.js
var TRACKABLE_CONSTRUCTOR_INFO = Symbol("trackableConstructor");
function syncProperty(settings) {
  settings ?? (settings = {});
  return function syncProperty2(target, context) {
    const trackableInfo = ensureTrackableConstructorInfo(context.metadata);
    trackableInfo.trackedProperties.set(context.name, settings);
    const result = {
      set(value) {
        target.set.call(this, value);
        const host = getHostObjectInfo(this);
        host?.onPropertyChanged(context.name, value);
      }
    };
    return result;
  };
}
function syncMethod(settings) {
  settings ?? (settings = {});
  return function syncMethod2(target, context) {
    const trackableInfo = ensureTrackableConstructorInfo(context.metadata);
    trackableInfo.trackedMethods.set(context.name, settings);
    const originalMethod = target;
    return function(...args) {
      const result = originalMethod.apply(this, args);
      const host = getObjectSyncMetaInfo(this)?.host;
      host?.onMethodExecute(context.name, ...args);
      return result;
    };
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
    trackableInfo.isAutoTrackable = true;
    trackableInfo.typeId = settings.typeId;
    trackableInfo.designations = settings.designations;
    if (settings.properties) {
      for (const [propertyKey, propertySettings] of Object.entries(settings.properties)) {
        trackableInfo.trackedProperties.set(propertyKey, propertySettings);
      }
    }
    if (settings.methods) {
      for (const [methodKey, methodSettings] of Object.entries(settings.methods)) {
        trackableInfo.trackedMethods.set(methodKey, methodSettings);
      }
    }
    if (settings.generator) {
      defaultGeneratorsByTypeId.set(settings.typeId, settings.generator);
    } else {
      defaultConstructorsByTypeId.set(settings.typeId, target);
    }
  };
}
function ensureTrackableConstructorInfo(metadata) {
  let trackableInfo = metadata[TRACKABLE_CONSTRUCTOR_INFO];
  if (!trackableInfo) {
    trackableInfo = {
      trackedProperties: /* @__PURE__ */ new Map(),
      trackedMethods: /* @__PURE__ */ new Map(),
      isAutoTrackable: false
    };
    metadata[TRACKABLE_CONSTRUCTOR_INFO] = trackableInfo;
  }
  return trackableInfo;
}
function checkCanUseProperty(constructor, propertyKey, designation) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return false;
  }
  const propertyInfo = constructorInfo.trackedProperties.get(propertyKey);
  if (!propertyInfo) {
    return false;
  }
  if (propertyInfo.designations === void 0)
    return true;
  if (designation === void 0)
    return true;
  return hasInIterable(propertyInfo.designations, designation);
}
function checkCanUseMethod(constructor, propertyKey, designation) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return false;
  }
  const propertyInfo = constructorInfo.trackedMethods.get(propertyKey);
  if (!propertyInfo) {
    return false;
  }
  if (propertyInfo.designations === void 0)
    return true;
  if (designation === void 0)
    return true;
  return hasInIterable(propertyInfo.designations, designation);
}
function checkCanUseObject(obj, designation) {
  return checkCanUseConstructor(obj.constructor, designation);
}
function checkCanUseConstructor(constructor, designation) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return false;
  }
  if (constructorInfo.designations === void 0)
    return true;
  if (designation === void 0)
    return true;
  return hasInIterable(constructorInfo.designations, designation);
}

// build/host/trackedTarget.js
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
      const hostObjectInfo = getHostObjectInfo(this);
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
      const hostObjectInfo = getHostObjectInfo(this);
      if (hostObjectInfo) {
        this._creation.push(...this.convertItemsToPropertyInfos(hostObjectInfo, items));
        this.addChange({ start: startIndex, deleteCount: 0, items: this.convertItemsToPropertyInfos(hostObjectInfo, items) });
      }
      this.onAdded(startIndex, items);
      return this._values.length;
    }
    convertPropertyInfosToItems(items, client) {
      return items.map((item) => client.getPropertyValue(item));
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
      const hostObjectInfo = getHostObjectInfo(this);
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
      const host = getHostObjectInfo(this);
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
    [onUpdateProperty](key, value, isForCreate, client) {
      if (isForCreate && key === "_creation") {
        this.value = this.convertPropertyInfosToItems(value, client);
      } else if (!isForCreate && key === "_changes") {
        this.applyTrackableArrayChanges(this._values, value, client);
      }
      return true;
    }
    applyTrackableArrayChanges(arr, changes, client) {
      for (const change of changes) {
        const newItems = this.convertPropertyInfosToItems(change.items, client);
        const removedItems = arr.splice(change.start, change.deleteCount, ...newItems);
        if (removedItems.length > 0)
          this.onRemoved(change.start, removedItems);
        if (change.items.length > 0)
          this.onAdded(change.start, newItems);
      }
      return arr;
    }
    // toJson and toValue
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

// build/host/hostObjectInfo.js
var nextInvokeId = 0;
function isForClientConnection(clientConnection, filter) {
  let hasDesignation = filter.designations === void 0 || clientConnection.designation === void 0;
  if (!hasDesignation) {
    hasDesignation = hasInIterable(filter.designations, clientConnection.designation);
  }
  let hasClientConnection = filter.clients === void 0;
  if (!hasClientConnection) {
    hasClientConnection = hasInIterable(filter.clients, clientConnection);
  }
  return filter.isExclusive === (hasDesignation && hasClientConnection);
}
var HostObjectInfo = class _HostObjectInfo extends ObjectInfoBase {
  /**
   * Constructs a TrackableObject with a typeId and optional objectId.
   */
  constructor(objectSyncMetaInfo, _isRootObject, _objectIdPrefix) {
    super(objectSyncMetaInfo);
    __publicField(this, "_isRootObject");
    __publicField(this, "_objectIdPrefix");
    /** Holds the current set of property changes for this object. */
    __publicField(this, "_changeSet");
    /** Holds pending method invocation messages for this object. */
    __publicField(this, "_methodInvokeCalls", []);
    /** Holds client filter settings for restricting visibility. */
    __publicField(this, "_clientFilters", null);
    /** Holds all registered client-specific views for this object. */
    __publicField(this, "_views", []);
    /** Holds the set of clients which know about this. */
    __publicField(this, "_clients", /* @__PURE__ */ new Set());
    this._isRootObject = _isRootObject;
    this._objectIdPrefix = _objectIdPrefix;
    this._changeSet = {
      type: "change",
      objectId: this.objectId,
      properties: {}
    };
  }
  /**
   * Creates a TrackableObject from a plain object, optionally specifying typeId and objectId.
   * Registers tracked properties and initializes their values.
   */
  static createFromObject(settings) {
    const metaInfo = ensureObjectSyncMetaInfo(settings);
    if (!metaInfo) {
      throw new Error("Failed to create HostObjectInfo: unable to ensure ObjectSyncMetaInfo.");
    }
    metaInfo.host = new _HostObjectInfo(metaInfo, settings.isRoot, settings.objectIdPrefix);
    invokeOnConvertedToTrackable(metaInfo.object, metaInfo.host);
    const trackableTypeInfo = getTrackableTypeInfo(settings.object.constructor);
    if (trackableTypeInfo) {
      trackableTypeInfo.trackedProperties.forEach((propertyInfo, key) => {
        metaInfo.host.onPropertyChanged(key, settings.object[key]);
      });
    }
    return metaInfo.host;
  }
  /**
   * Ensures an object is auto-trackable, returning a TrackableObject if possible.
   * If the object is already trackable, returns the existing wrapper.
   */
  static tryEnsureAutoTrackable(settings) {
    if (!settings.object || typeof settings.object !== "object")
      return null;
    const trackableTypeInfo = getTrackableTypeInfo(settings.object.constructor);
    if (trackableTypeInfo?.isAutoTrackable !== true)
      return null;
    const metaInfo = ensureObjectSyncMetaInfo(settings);
    if (!metaInfo) {
      throw new Error("Failed to create HostObjectInfo: unable to ensure ObjectSyncMetaInfo.");
    }
    return metaInfo.host ?? this.createFromObject(settings);
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
    return this._changeSet.properties;
  }
  /**
   * Determines if this object is visible to a given client based on filters.
   */
  isForClient(client) {
    if (!this._clientFilters)
      return true;
    const filter = this._clientFilters;
    return isForClientConnection(client, filter);
  }
  /**
   * Adds a client-specific view to this object.
   */
  addView(view) {
    this._views.push(view);
  }
  /**
   * Removes a client-specific view from this object.
   * @returns true if the view was removed, false otherwise.
   */
  removeView(view) {
    const initialLength = this._views.length;
    this._views = this._views.filter((v) => v !== view);
    return this._views.length < initialLength;
  }
  /**
   * Returns all registered client-specific views for this object.
   */
  get allRegisteredViews() {
    return this._views;
  }
  /**
   * Returns all views that apply to a given client.
   */
  getViewsForClient(client) {
    return this._views.filter((view) => !view.filter || hasInIterable(view.filter.clients, client) === view.filter.isExclusive);
  }
  /**
   * Removes all client restrictions, making the object visible to all clients.
   */
  removeClientRestrictions() {
    this._clientFilters = null;
  }
  /**
   * Restricts the object to a set of clients (inclusive or exclusive).
   */
  setClientRestriction(filter) {
    this._clientFilters = {
      clients: filter.clients ? toIterable(filter.clients, true) : void 0,
      designations: filter.designations ? toIterable(filter.designations, true) : void 0,
      isExclusive: filter.isExclusive ?? true
    };
  }
  /**
   * Records a property change, converting values to trackable references if needed.
   */
  onPropertyChanged(key, value) {
    let current = this._changeSet.properties[key];
    if (!current) {
      current = { hasPendingChanges: true, [isPropertyInfoSymbol]: true };
      this._changeSet.properties[key] = current;
    } else if (current.value === value) {
      return;
    }
    this.convertToTrackableObjectReference(value);
    const metaInfo = getObjectSyncMetaInfo(value);
    const objectId = metaInfo?.objectId;
    current.value = value;
    current.objectId = objectId;
    current.hasPendingChanges = true;
  }
  /**
   * Records a method execution for this object, converting arguments to trackable references if needed.
   */
  onMethodExecute(method, ...args) {
    const parameters = [];
    args.forEach((arg, index) => {
      const trackable = this.convertToTrackableObjectReference(arg);
      const paramInfo = {
        value: trackable ?? arg,
        objectId: trackable?.objectSyncMetaInfo.objectId,
        [isPropertyInfoSymbol]: true
      };
      parameters.push(paramInfo);
    });
    const message = {
      type: "execute",
      id: nextInvokeId++,
      objectId: this.objectId,
      parameters,
      method
    };
    this._methodInvokeCalls.push(message);
  }
  /**
   * Converts a value to a trackable object reference if possible.
   */
  convertToTrackableObjectReference(target) {
    if (target && typeof target === "object") {
      return _HostObjectInfo.tryEnsureAutoTrackable({
        object: target,
        isRoot: false,
        objectIdPrefix: this._objectIdPrefix
      });
    }
    return null;
  }
  /**
   * Generates a create message for this object for a given client, applying any view-based typeId overrides.
   * Returns null if the object should not be sent to the client.
   */
  getCreateMessage(client) {
    let typeId = this.typeId;
    const views = this.getViewsForClient(client).filter((v) => v.onTypeId);
    for (const view of views) {
      const newTypeId = view.onTypeId(client, typeId);
      if (!newTypeId)
        return null;
      typeId = newTypeId;
    }
    const result = {
      type: "create",
      objectId: this.objectId,
      typeId,
      properties: this.getProperties(client, false)
    };
    return result;
  }
  /**
   * Generates a delete message for this object.
   */
  getDeleteMessage() {
    const result = {
      type: "delete",
      objectId: this.objectId
    };
    return result;
  }
  /**
   * Generates a change message for this object for a given client, including only changed properties.
   * Returns null if there are no changes.
   */
  getChangeMessage(client) {
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
  /**
   * Returns all pending execute messages for this object.
   */
  getExecuteMessages(client) {
    return this._methodInvokeCalls.filter((msg) => {
      return checkCanUseMethod(this.object.constructor, msg.method, client.designation);
    });
  }
  /**
   * Gathers property info for this object for a given client, applying any view-based property overrides.
   * If includeChangedOnly is true, only changed properties are included.
   */
  getProperties(client, includeChangedOnly) {
    const views = this.getViewsForClient(client).filter((v) => v.onProperty);
    const result = {};
    Object.keys(this._changeSet.properties).forEach((key) => {
      const propertyInfo = this._changeSet.properties[key];
      if (includeChangedOnly && !propertyInfo.hasPendingChanges)
        return;
      if (!checkCanUseProperty(this.object.constructor, key, client.designation))
        return;
      let clientPropertyInfo = {
        objectId: propertyInfo.objectId,
        value: propertyInfo.value,
        [isPropertyInfoSymbol]: true
      };
      if (propertyInfo.objectId === void 0 && propertyInfo.objectId === null) {
        delete clientPropertyInfo.objectId;
      }
      for (const view of views) {
        const newPropertyInfo = view.onProperty(client, key, clientPropertyInfo);
        if (newPropertyInfo === null) {
          return;
        }
        clientPropertyInfo = newPropertyInfo;
      }
      result[key] = clientPropertyInfo;
    });
    return result;
  }
  /**
   * Resets the hasPendingChanges flag for all properties and clears pending method calls.
   */
  tick() {
    Object.keys(this._changeSet.properties).forEach((key) => {
      const propertyInfo = this._changeSet.properties[key];
      propertyInfo.hasPendingChanges = false;
    });
    this._methodInvokeCalls.length = 0;
    invokeOnTick(this.objectSyncMetaInfo.object);
  }
};

// build/host/host.js
var ObjectSyncHost = class {
  constructor(_settings = {}) {
    __publicField(this, "_settings");
    /** Pool of all currently tracked objects and their info. */
    __publicField(this, "_trackedObjectPool");
    /** Maps client IDs to lists of delete messages for objects that have been untracked. */
    __publicField(this, "_untrackedObjectInfosByClient", /* @__PURE__ */ new Map());
    __publicField(this, "_clients", /* @__PURE__ */ new Set());
    this._settings = _settings;
    if (!this._settings.objectIdPrefix) {
      this._settings.objectIdPrefix = `host-${Date.now()}-`;
    }
    this._trackedObjectPool = this._settings.objectPool ?? new TrackedObjectPool();
  }
  /** Returns all currently tracked objects. */
  get allTrackedObjects() {
    return this._trackedObjectPool.all;
  }
  registerClient(settings = {}) {
    const clientToken = JSON.parse(JSON.stringify(settings));
    this._clients.add(clientToken);
    return clientToken;
  }
  /**
   * Removes all client-specific state for a client (e.g., when disconnecting).
   */
  removeClient(client) {
    if (!this._clients.has(client)) {
      throw new Error("Unknown client token");
    }
    this._trackedObjectPool.all.forEach((obj) => {
      const hostObjectInfo = getHostObjectInfo(obj);
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
  setClientRestriction(obj, filter) {
    const tracked = getHostObjectInfo(obj);
    if (!tracked)
      throw new Error("Object is not tracked");
    tracked.setClientRestriction(filter);
  }
  /**
   * Adds a client-specific view to a tracked object.
   */
  addView(obj, view) {
    const tracked = getHostObjectInfo(obj);
    if (!tracked)
      throw new Error("Object is not tracked");
    tracked.addView(view);
  }
  /**
   * Removes a client-specific view from a tracked object.
   * @returns true if the view was removed, false otherwise.
   */
  removeView(obj, view) {
    const tracked = getHostObjectInfo(obj);
    if (!tracked)
      return false;
    return tracked.removeView(view);
  }
  /**
   * Begins tracking an object, optionally with settings for object ID and client visibility.
   * Throws if objectId is specified for an already-trackable object.
   */
  track(target, trackSettings) {
    this.trackInternal(target, trackSettings);
  }
  trackInternal(target, trackSettings) {
    if (!target)
      return null;
    const isRoot = trackSettings?.isRoot !== false;
    if (this._trackedObjectPool.has(target) && getHostObjectInfo(target)) {
      if (isRoot && (trackSettings?.ignoreAlreadyTracked ?? false) === false) {
        throw new Error("Object is already tracked");
      }
      return null;
    }
    const creationSettings = {
      objectId: trackSettings?.objectId,
      isRoot,
      object: target,
      objectIdPrefix: this._settings.objectIdPrefix
    };
    const hostObjectInfo = getHostObjectInfo(target) ?? HostObjectInfo.tryEnsureAutoTrackable(creationSettings) ?? HostObjectInfo.createFromObject(creationSettings);
    if (!hostObjectInfo)
      return null;
    if (!this._trackedObjectPool.has(target))
      this._trackedObjectPool.add(target);
    this._untrackedObjectInfosByClient.forEach((deleteMessages, client) => {
      let deleteMessageIndex = deleteMessages.findIndex((m) => m.objectId === hostObjectInfo.objectId);
      if (deleteMessageIndex === -1)
        return;
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
  untrack(target) {
    if (this.untrackInternal(target, true))
      this.removeUnusedObjects();
  }
  untrackInternal(target, throwWhenNotTracked) {
    const hostObjectInfo = getHostObjectInfo(target);
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
  gatherUntrackedObjectInfos(data) {
    return this.gatherUntrackedObjectInfosFromRaw(data.properties);
  }
  gatherUntrackedObjectInfosFromRaw(data, tracked = /* @__PURE__ */ new Set()) {
    if (tracked.has(data)) {
      return [];
    }
    tracked.add(data);
    const result = [];
    if (isPropertyInfo(data)) {
      const propertyInfo = data;
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
        if (!value || typeof value !== "object")
          return;
        result.push(...this.gatherUntrackedObjectInfosFromRaw(value, tracked));
      });
      return result;
    }
    Object.keys(data).forEach((key) => {
      const value = data[key];
      if (!value || typeof value !== "object")
        return;
      if (!isPropertyInfo(value)) {
        result.push(...this.gatherUntrackedObjectInfosFromRaw(value, tracked));
        return;
      }
      const propertyInfo = value;
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
  getMessages(tick = true) {
    const result = /* @__PURE__ */ new Map();
    for (const client of this._clients) {
      result.set(client, this.getMessagesForClientInternal(client));
    }
    if (tick)
      this.tick();
    return result;
  }
  /**
   * Internal: Gathers all messages for a client.
   */
  getMessagesForClientInternal(client) {
    const messages = [];
    let all = this._trackedObjectPool.all;
    let newTrackableObjects = [];
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
  getMessagesForTrackableObjectInfo(syncObject2, client, messages, newTrackableObjects) {
    if (!checkCanUseObject(syncObject2, client.designation))
      return;
    if (!checkCanUseObject(syncObject2, this._settings.designation))
      return;
    const hostObjectInfo = getHostObjectInfo(syncObject2);
    if (!hostObjectInfo?.isForClient(client))
      return;
    const hasClient = hostObjectInfo.clients.has(client);
    let message;
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
    const executeMessages = hostObjectInfo.getExecuteMessages(client);
    messages.push(...executeMessages);
  }
  tick() {
    this._trackedObjectPool.all.forEach((obj) => {
      const hostObjectInfo = getHostObjectInfo(obj);
      hostObjectInfo?.tick();
    });
  }
  /**
   * Removes all tracked objects that are not reachable from any of the provided root objects.
   * Traverses the object graph starting from the roots and untracks all unreachable objects.
   */
  removeUnusedObjects() {
    const reachable = /* @__PURE__ */ new Set();
    const stack = [];
    const visit = (obj) => {
      if (!reachable.has(obj)) {
        reachable.add(obj);
        stack.push(obj);
      }
    };
    const allRootObjects = this._trackedObjectPool.all.filter((info) => {
      const hostObjectInfo = getHostObjectInfo(info);
      return hostObjectInfo.isRootObject;
    });
    for (const root of allRootObjects) {
      visit(root);
    }
    while (stack.length > 0) {
      const current = stack.pop();
      const hostObjectInfo = getHostObjectInfo(current);
      const properties = hostObjectInfo.properties;
      for (const key of Object.keys(properties)) {
        const value = properties[key].value;
        if (value && typeof value === "object") {
          visit(value);
        }
      }
    }
    for (const tracked of this._trackedObjectPool.all) {
      if (!reachable.has(tracked)) {
        this.untrackInternal(tracked, false);
      }
    }
  }
};

// build/shared/objectSync.js
var ObjectSync = class {
  constructor(_settings) {
    __publicField(this, "_settings");
    __publicField(this, "_host");
    __publicField(this, "_client");
    this._settings = _settings;
    const objectPool = new TrackedObjectPool();
    this._host = new ObjectSyncHost({
      objectPool,
      ...this._settings
    });
    this._client = new ObjectSyncClient({
      objectPool
    });
  }
  get host() {
    return this._host;
  }
  get client() {
    return this._client;
  }
  getMessages() {
    return this._host.getMessages();
  }
  applyMessages(messagesByClient) {
    for (const [clientToken, messages] of messagesByClient) {
      const results = this._client.apply(messages);
      for (const obj of results.newTrackedObjects) {
        this._host.track(obj, {
          ignoreAlreadyTracked: true,
          knownClients: clientToken
        });
      }
    }
  }
};
export {
  ObjectSync,
  ObjectSyncClient,
  ObjectSyncHost,
  SyncableArray,
  onCreated,
  onDeleted,
  onUpdateProperty,
  onUpdated,
  syncMethod,
  syncObject,
  syncProperty
};
//# sourceMappingURL=index.js.map
