var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// build/shared/clientToken.js
var ClientToken = class {
  constructor(identity) {
    __publicField(this, "identity");
    this.identity = identity;
  }
};

// build/shared/messages.js
var isPropertyInfoSymbol = Symbol("isPropertyInfo");
var CreateMessageType = "create";
var ChangeMessageType = "change";
var DeleteMessageType = "delete";
var ExecuteMessageType = "execute";
var ExecuteFinishedMessageType = "executeFinished";
function isExecuteObjectMessage(message) {
  return isObjectMessage(message, ExecuteMessageType);
}
function isChangeObjectMessage(message) {
  return isObjectMessage(message, ChangeMessageType);
}
function isCreateObjectMessage(message) {
  return isObjectMessage(message, CreateMessageType);
}
function isDeleteObjectMessage(message) {
  return isObjectMessage(message, DeleteMessageType);
}
function isExecuteFinishedObjectMessage(message) {
  return isObjectMessage(message, ExecuteFinishedMessageType);
}
function isObjectMessage(message, type) {
  return message.type === type;
}

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
  if (isIterable(input)) {
    for (const item of input) {
      callback(item);
    }
  } else {
    callback(input);
  }
}
function hasInIterable(input, expected) {
  if (input instanceof Set) {
    return input.has(expected);
  } else if (input instanceof Map) {
    return input.has(expected);
  } else if (Array.isArray(input)) {
    return input.includes(expected);
  } else if (isIterable(input)) {
    for (const item of input) {
      if (item === expected) {
        return true;
      }
    }
    return false;
  } else {
    return input === expected;
  }
}
function isPrimitiveValue(value) {
  return value === void 0 || value === null || typeof value !== "object" && typeof value !== "function";
}
function isPromiseLike(value) {
  return value && typeof value.then === "function" && typeof value.catch === "function";
}

// build/shared/disposable.js
function createDisposable(disposeFunction, additionalData) {
  if (!disposeFunction) {
    return {
      dispose() {
      },
      [Symbol.dispose]() {
      },
      ...additionalData
    };
  }
  let isDisposed = false;
  return {
    dispose() {
      if (isDisposed)
        return;
      isDisposed = true;
      disposeFunction();
    },
    [Symbol.dispose]() {
      this.dispose();
    },
    ...additionalData
  };
}

// build/shared/metaInfo.js
var metaInfoByInstance = /* @__PURE__ */ new WeakMap();
var MetaInfo = class extends EventEmitter {
};
function getMetaInfo(instance, metaInfoType, metaInfoGeneratorOrCreateByConstructor) {
  let metaInfo = metaInfoByInstance.get(instance) ?? null;
  if (metaInfo) {
    if (!(metaInfo instanceof metaInfoType))
      return null;
    return metaInfo;
  }
  if (metaInfoGeneratorOrCreateByConstructor === false || metaInfoGeneratorOrCreateByConstructor === void 0)
    return null;
  const metaInfoGenerator = typeof metaInfoGeneratorOrCreateByConstructor === "function" ? metaInfoGeneratorOrCreateByConstructor : void 0;
  metaInfo = metaInfoGenerator ? metaInfoGenerator(instance) : new metaInfoType();
  if (!metaInfo)
    return null;
  metaInfoByInstance.set(instance, metaInfo);
  return metaInfo;
}

// build/shared/clientFilter.js
function isForClientToken(clientToken, filter) {
  let hasDesignation = filter.identities === void 0 || clientToken.identity === void 0;
  if (!hasDesignation) {
    hasDesignation = hasInIterable(filter.identities, clientToken.identity);
  }
  let hasClientToken = filter.clientTokens === void 0;
  if (!hasClientToken) {
    hasClientToken = hasInIterable(filter.clientTokens, clientToken);
  }
  return filter.isExclusive === (hasDesignation && hasClientToken);
}

// build/syncAgents/syncAgent.js
var SyncAgent = class {
  constructor(_objectInfo) {
    __publicField(this, "_objectInfo");
    __publicField(this, "_clients", /* @__PURE__ */ new Set());
    __publicField(this, "_storedReferencesByKey", /* @__PURE__ */ new Map());
    __publicField(this, "_hasPendingChanges", false);
    __publicField(this, "_clientFilters", null);
    this._objectInfo = _objectInfo;
  }
  get hasPendingChanges() {
    return this._hasPendingChanges;
  }
  set hasPendingChanges(value) {
    if (this._hasPendingChanges)
      return;
    this._hasPendingChanges = value;
    this.reportPendingMessages();
  }
  get objectId() {
    return this._objectInfo.objectId;
  }
  get instance() {
    return this._objectInfo.instance;
  }
  set instance(value) {
    this._objectInfo.instance = value;
    this.onInstanceSet(true);
  }
  onInstanceSet(createdByCreateObjectMessage) {
    if (!createdByCreateObjectMessage) {
      this.reportPendingMessages();
    }
  }
  get clients() {
    return this._clients;
  }
  onClientUnregistered(clientToken) {
    this._clients.delete(clientToken);
    this.clearStoredReferences(clientToken);
  }
  clearStates(clientToken) {
    if (!clientToken) {
      this._hasPendingChanges = false;
    }
  }
  reportPendingMessages() {
    this._objectInfo.owner.reportPendingMessagesForObject(this._objectInfo);
  }
  serializeValue(valueOrSettings, clientToken) {
    if (!clientToken) {
      const settings = valueOrSettings;
      this.storeReference(settings);
      if ("value" in settings) {
        return this._objectInfo.owner.serializeValue(settings.value, settings.clientToken);
      } else {
        return settings.values.map((value) => this._objectInfo.owner.serializeValue(value, settings.clientToken));
      }
    }
    return this._objectInfo.owner.serializeValue(valueOrSettings, clientToken);
  }
  deserializeValue(value, clientToken, allowedTypes) {
    return this._objectInfo.owner.deserializeValue(value, clientToken, allowedTypes);
  }
  storeReference(settings) {
    let storedReferencesByClient = this._storedReferencesByKey.get(settings.key);
    if (!storedReferencesByClient) {
      storedReferencesByClient = /* @__PURE__ */ new Map();
      this._storedReferencesByKey.set(settings.key, storedReferencesByClient);
    }
    const previousStoredReference = storedReferencesByClient.get(settings.clientToken);
    previousStoredReference?.dispose();
    const disposables = [];
    const values = "value" in settings ? [settings.value] : settings.values;
    for (const value of values) {
      if (isPrimitiveValue(value))
        continue;
      const storedReference = this._objectInfo.owner.trackInternal(value).addReference(settings.clientToken);
      disposables.push(storedReference);
    }
    if (disposables.length === 0) {
      return createDisposable();
    }
    const finalStoredReference = createDisposable(() => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
      storedReferencesByClient.delete(settings.clientToken);
      if (storedReferencesByClient.size === 0) {
        this._storedReferencesByKey.delete(settings.key);
      }
    });
    storedReferencesByClient.set(settings.clientToken, finalStoredReference);
    return finalStoredReference;
  }
  clearStoredReferences(keyOrClientToken, clientToken) {
    if (keyOrClientToken instanceof ClientToken) {
      const clientToken2 = keyOrClientToken;
      this._storedReferencesByKey.forEach((storedReferencesByClient) => {
        const storedReference = storedReferencesByClient.get(clientToken2);
        storedReference?.dispose();
      });
    } else {
      const key = keyOrClientToken;
      const storedReferencesByClient = this._storedReferencesByKey.get(key);
      if (storedReferencesByClient) {
        storedReferencesByClient.forEach((storedReference) => {
          if (!clientToken || storedReferencesByClient.has(clientToken)) {
            storedReference.dispose();
          }
        });
      }
    }
  }
  createMessage(type, payload, ...extraArguments) {
    const message = {
      type,
      objectId: this.objectId
    };
    if (isObjectMessage(message, CreateMessageType)) {
      message.data = payload;
      if (this._objectInfo.isRoot)
        message.isRoot = true;
      let typeId;
      if (extraArguments[0] instanceof ClientToken) {
        typeId = this.getTypeId(extraArguments[0]);
      } else {
        typeId = extraArguments[0];
      }
      message.typeId = typeId;
      message.data = payload;
    } else if (isObjectMessage(message, ChangeMessageType)) {
      message.data = payload;
    } else {
      Object.assign(message, payload);
    }
    return message;
  }
  set clientRestriction(filter) {
    if (!filter) {
      this._clientFilters = null;
      return;
    }
    this._clientFilters = {
      clientTokens: filter.clientTokens ? toIterable(filter.clientTokens, true) : void 0,
      identities: filter.identities ? toIterable(filter.identities, true) : void 0,
      isExclusive: filter.isExclusive ?? true
    };
  }
  get clientRestriction() {
    return this._clientFilters;
  }
  isForClientToken(clientToken) {
    if (!this._clientFilters)
      return true;
    const filter = this._clientFilters;
    return isForClientToken(clientToken, filter);
  }
};

// build/syncAgents/syncAgentProvider.js
var defaultSyncAgentProviders = [];
var defaultIntrinsicSyncAgentProviders = [];
var SyncAgentProvider = class {
  constructor(_settings) {
    __publicField(this, "_settings");
    this._settings = _settings;
    if (_settings.isIntrinsic)
      defaultIntrinsicSyncAgentProviders.push(this);
    else
      defaultSyncAgentProviders.push(this);
  }
  get priority() {
    return this._settings.priority ?? 0;
  }
  get syncType() {
    return this._settings.syncType;
  }
  canProvideAgentFor(typeOrTypeId) {
    if (typeof typeOrTypeId === "string") {
      return typeOrTypeId === this._settings.typeId;
    }
    if (this._settings.matchExactType) {
      return typeOrTypeId.constructor === this._settings.syncType;
    } else {
      return typeOrTypeId instanceof this._settings.syncType;
    }
  }
  createAgent(objectInfo) {
    return new this._settings.syncAgentType(objectInfo);
  }
};

// build/syncAgents/extendedSyncAgent.js
var ExtendedSyncAgent = class extends SyncAgent {
  constructor(objectInfo) {
    super(objectInfo);
    __publicField(this, "_messageTypeToHandler", /* @__PURE__ */ new Map());
    __publicField(this, "_isApplyingMessages", 0);
    this.registerMessageHandler("create", (message, clientToken) => this.onCreateMessageReceived(message, clientToken));
    this.registerMessageHandler("change", (message, clientToken) => this.onChangeMessageReceived(message, clientToken));
  }
  get isApplyingMessages() {
    return this._isApplyingMessages > 0;
  }
  registerMessageHandler(messageType, handler) {
    this._messageTypeToHandler.set(messageType, handler);
  }
  applyMessage(message, clientToken) {
    this._isApplyingMessages++;
    try {
      const handler = this._messageTypeToHandler.get(message.type);
      if (handler) {
        return handler(message, clientToken);
      } else if (message.type === "create") {
        throw new Error(`No handler registered for message type '${message.type}' in serializer.`);
      }
    } finally {
      this._isApplyingMessages--;
    }
  }
  onChangeMessageReceived(message, clientToken) {
  }
};

// build/syncAgents/simpleSyncAgent.js
function createSimpleSyncAgentProvider(settings) {
  const { type, typeId, serialize, deserialize } = settings;
  const SyncAgent2 = class SimpleSyncAgent extends ExtendedSyncAgent {
    getTypeId(clientToken) {
      return typeId;
    }
    generateMessages(clientToken, isNewClient) {
      if (isNewClient)
        return [this.createMessage("create", serialize(this.instance), clientToken)];
      return [];
    }
    onCreateMessageReceived(message, clientToken) {
      this.instance = deserialize(message.data);
    }
  };
  const agentProvider = new SyncAgentProvider({
    syncAgentType: SyncAgent2,
    syncType: type,
    typeId,
    matchExactType: true
  });
  return agentProvider;
}

// build/syncAgents/agents/syncObject/types.js
var nothing = Symbol("nothing");

// build/syncAgents/agents/syncObject/typedSyncAgent.js
var syncAgentProvidersByType = /* @__PURE__ */ new Map();
function getSyncObjectSyncAgentProvider(type) {
  if (syncAgentProvidersByType.has(type)) {
    return syncAgentProvidersByType.get(type);
  }
  const typeId = getTrackableTypeInfo(type).typeId;
  const TypedSyncObjectyncAgent = class TypedSyncObjectyncAgent extends SyncObjectSyncAgent {
    get type() {
      return type;
    }
    constructor(objectInfo) {
      super(objectInfo, typeId);
    }
  };
  const provider = new SyncAgentProvider({
    syncAgentType: TypedSyncObjectyncAgent,
    syncType: type,
    typeId,
    matchExactType: true,
    isIntrinsic: false
  });
  syncAgentProvidersByType.set(type, provider);
  return provider;
}

// build/syncAgents/agents/syncObject/decorators/syncObject.js
var TRACKABLE_CONSTRUCTOR_INFO = Symbol("trackableConstructor");
var allSyncObjectTypes = /* @__PURE__ */ new Set();
function syncObject(settings) {
  return function syncObject2(target, context) {
    settings ?? (settings = {});
    settings.typeId ?? (settings.typeId = context.name);
    const trackableInfo = ensureTrackableConstructorInfo(context.metadata);
    trackableInfo.typeId = settings.typeId;
    trackableInfo.clientTypeId = settings.clientTypeId;
    trackableInfo.constructorArguments = settings.constructorArguments;
    trackableInfo.allowedConstructorParameterTypesFromSender = settings.allowedConstructorParameterTypesFromSender;
    if (settings.properties) {
      for (const [propertyKey, propertySettings] of Object.entries(settings.properties)) {
        trackableInfo.trackedProperties.set(propertyKey, {
          ...propertySettings
        });
      }
    }
    if (settings.methods) {
      for (const [methodKey, methodSettings] of Object.entries(settings.methods)) {
        trackableInfo.trackedMethods.set(methodKey, {
          ...methodSettings
        });
      }
    }
    context.addInitializer(() => {
      const provider = getSyncObjectSyncAgentProvider(target);
      if (!defaultSyncAgentProviders.find((p) => p === provider)) {
        defaultSyncAgentProviders.push(provider);
      }
    });
    allSyncObjectTypes.add(target);
  };
}
function ensureTrackableConstructorInfo(metadata) {
  const oldTrackableInfo = metadata[TRACKABLE_CONSTRUCTOR_INFO] ?? {
    trackedProperties: /* @__PURE__ */ new Map(),
    trackedMethods: /* @__PURE__ */ new Map(),
    isAutoTrackable: false,
    clientTypeId: void 0
  };
  const newTrackableInfo = {
    trackedProperties: new Map(oldTrackableInfo.trackedProperties),
    trackedMethods: new Map(oldTrackableInfo.trackedMethods),
    typeId: oldTrackableInfo.typeId,
    clientTypeId: oldTrackableInfo.clientTypeId
  };
  metadata[TRACKABLE_CONSTRUCTOR_INFO] = newTrackableInfo;
  return newTrackableInfo;
}
function getTrackableTypeInfo(ctor) {
  const trackableInfo = ctor[Symbol.metadata]?.[TRACKABLE_CONSTRUCTOR_INFO];
  return trackableInfo ?? null;
}
function beforeSendObjectToClient(constructor, instance, typeId, destinationClientToken) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return nothing;
  }
  if (constructorInfo.clientTypeId === void 0) {
    return typeId;
  }
  if (constructorInfo.clientTypeId === null || constructorInfo.clientTypeId === nothing) {
    return nothing;
  }
  if (typeof constructorInfo.clientTypeId === "string") {
    return constructorInfo.clientTypeId;
  }
  if (typeof constructorInfo.clientTypeId !== "function") {
    throw new Error(`Invalid clientTypeId in trackable constructor info.`);
  }
  const newConstructorInfo = getTrackableTypeInfo(constructorInfo.clientTypeId);
  if (newConstructorInfo && newConstructorInfo.typeId) {
    return newConstructorInfo.typeId;
  }
  const result = constructorInfo.clientTypeId.call(instance, { instance, constructor, typeId, destinationClientToken });
  if (result === null || result === void 0 || result === nothing) {
    return nothing;
  }
  if (typeof result === "string") {
    return result;
  }
  if (typeof result === "function") {
    const newConstructorInfo2 = getTrackableTypeInfo(result);
    if (newConstructorInfo2 && newConstructorInfo2.typeId) {
      return newConstructorInfo2.typeId;
    }
    throw new Error(`The constructor returned from beforeSendToClient does not have a typeId.`);
  }
  return typeId;
}

// build/syncAgents/agents/syncObject/decorators/syncMethod.js
function syncMethod(settings) {
  settings ?? (settings = {});
  return function syncMethod2(target, context) {
    const trackableInfo = ensureTrackableConstructorInfo(context.metadata);
    const methodInfo = {
      ...settings
    };
    const methodName = context.name;
    trackableInfo.trackedMethods.set(methodName, methodInfo);
  };
}
function beforeExecuteOnClient(constructor, instance, methodKey, args, destinationClientToken) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return false;
  }
  const methodInfo = constructorInfo.trackedMethods.get(methodKey);
  if (!methodInfo || methodInfo.mode === "none" || methodInfo.mode === "applyOnly") {
    return false;
  }
  if (methodInfo.beforeExecuteOnClient?.call(instance, { instance, key: methodKey, args, destinationClientToken }) === false) {
    return false;
  }
  return true;
}
function getSyncMethodInfo(constructor, propertyKey) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return null;
  }
  const propertyInfo = constructorInfo.trackedMethods.get(propertyKey);
  return propertyInfo ?? null;
}

// build/syncAgents/agents/syncObject/metaInfo.js
var ObjectSyncMetaInfo = class extends MetaInfo {
  reportPropertyChanged(instance, propertyInfo, propertyKey, value) {
    this.emit("propertyChanged", propertyInfo, instance, propertyKey, value);
  }
};

// build/syncAgents/agents/syncObject/decorators/syncProperty.js
function syncProperty(settings) {
  settings ?? (settings = {});
  return function syncProperty2(target, context) {
    const trackableInfo = ensureTrackableConstructorInfo(context.metadata);
    const propertyInfo = {
      ...settings
    };
    const propertyName = context.name;
    trackableInfo.trackedProperties.set(propertyName, propertyInfo);
    const result = {
      set(value) {
        target.set.call(this, value);
        if (propertyInfo.mode === "none" || propertyInfo.mode === "applyOnly")
          return;
        const metaInfo = getMetaInfo(this, ObjectSyncMetaInfo);
        metaInfo?.reportPropertyChanged(this, propertyInfo, propertyName, value);
      }
    };
    return result;
  };
}
function checkCanApplyProperty(constructor, instance, propertyKey, isMethod, sourceClientToken) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo)
    return false;
  const propertyInfo = isMethod ? constructorInfo.trackedMethods.get(propertyKey) : constructorInfo.trackedProperties.get(propertyKey);
  if (!propertyInfo)
    return false;
  if (propertyInfo.mode === "none" || propertyInfo.mode === "trackOnly")
    return;
  if (propertyInfo.canApply?.call(instance, { instance, key: propertyKey, sourceClientToken }) === false)
    return false;
  return true;
}
function beforeSendPropertyToClient(constructor, instance, propertyKey, value, destinationClientToken) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return {
      skip: true
    };
  }
  const propertyInfo = constructorInfo.trackedProperties.get(propertyKey);
  if (!propertyInfo) {
    return {
      skip: true
    };
  }
  if (!propertyInfo.beforeSendToClient) {
    return {
      value
    };
  }
  const result = propertyInfo.beforeSendToClient.call(instance, { instance, key: propertyKey, value, destinationClientToken });
  if (result === nothing) {
    return {
      skip: true
    };
  }
  return {
    value: result
  };
}

// build/syncAgents/agents/syncObject/agent.js
var constructorPropertyName = "[[constructor]]";
var SyncObjectSyncAgent = class extends ExtendedSyncAgent {
  constructor(objectInfo, _typeId) {
    super(objectInfo);
    __publicField(this, "_typeId");
    __publicField(this, "_typeInfo", null);
    __publicField(this, "_properties", /* @__PURE__ */ new Map());
    __publicField(this, "_pendingInvokeMethodInfosById", /* @__PURE__ */ new Map());
    __publicField(this, "_methodInvokeResultsByClient", /* @__PURE__ */ new Map());
    __publicField(this, "_nextInvokeId", 0);
    this._typeId = _typeId;
    this.registerMessageHandler("execute", (message, clientToken) => this.onExecuteMessageReceived(message, clientToken));
    this.registerMessageHandler("executeFinished", (message, clientToken) => this.onExecuteFinishedMessageReceived(message, clientToken));
  }
  onInstanceSet(createdByCreateObjectMessage) {
    super.onInstanceSet(createdByCreateObjectMessage);
    const metaInfo = getMetaInfo(this.instance, ObjectSyncMetaInfo, true);
    metaInfo?.on("propertyChanged", (propertyInfo, instance, propertyKey, value) => {
      this.reportPropertyChanged(propertyInfo, propertyKey, value);
    });
    this._typeInfo = getTrackableTypeInfo(this.instance.constructor);
    this._typeInfo.trackedProperties.forEach((propertyInfo, key) => {
      this.reportPropertyChanged(propertyInfo, key, this.instance[key]);
    });
  }
  onCreateMessageReceived(message, clientToken) {
    const typeInfo = getTrackableTypeInfo(this.type);
    const constructorArguments = (message.data[constructorPropertyName] ?? []).map((arg, index) => {
      return this.deserializeValue(arg, clientToken, typeInfo.allowedConstructorParameterTypesFromSender ? typeInfo.allowedConstructorParameterTypesFromSender[index] ?? [] : void 0);
    });
    this.instance = new this.type(...constructorArguments);
    const possiblePromise = this.onChangeMessageReceived(message, clientToken);
    if (isPromiseLike(possiblePromise)) {
      throw new Error("onChangeMessageReceived cannot be async when receiving a create message because the instance needs to be created synchronously.");
    }
    this._properties.forEach((propertyValueInfo, propertyKey) => {
      propertyValueInfo.hasPendingChanges = false;
    });
  }
  onChangeMessageReceived(message, clientToken) {
    for (const key of Object.keys(message.data)) {
      if (key === constructorPropertyName)
        continue;
      if (!checkCanApplyProperty(this.instance.constructor, this.instance, key, false, clientToken))
        continue;
      const property = this._properties.get(key);
      if (!property) {
        throw new Error(`Received change for untracked property '${key}' on object with id ${this.objectId}.`);
      }
      const originalValue = this.instance[key];
      const value = this.deserializeValue(message.data[key], clientToken, property.propertyInfo.allowedTypesFromSender);
      if (originalValue === value)
        continue;
      this.instance[key] = value;
      const self = this;
      property.propertyInfo.afterValueChanged?.call(this.instance, {
        instance: this.instance,
        key,
        value,
        sourceClientToken: clientToken,
        get syncAgent() {
          return self._objectInfo.owner.getSyncAgentOrNull(value);
        }
      });
    }
  }
  onExecuteMessageReceived(message, clientToken) {
    const finishInvoke = (result, error) => {
      let methodInvokeResults = this._methodInvokeResultsByClient.get(clientToken);
      if (!methodInvokeResults) {
        methodInvokeResults = [];
        this._methodInvokeResultsByClient.set(clientToken, methodInvokeResults);
      }
      if (error)
        methodInvokeResults.push({ objectId: message.objectId, invokeId: message.invokeId, error });
      else
        methodInvokeResults.push({ objectId: message.objectId, invokeId: message.invokeId, result });
      this.reportPendingMessages();
    };
    const method = this.instance[message.method];
    if (typeof method !== "function") {
      finishInvoke(null, new Error(`Target with id ${message.objectId} has no method ${message.method}`));
      return;
    }
    const constructorInfo = getTrackableTypeInfo(this.instance.constructor);
    const methodInfo = constructorInfo.trackedMethods.get(message.method);
    if (!methodInfo) {
      finishInvoke(null, new Error(`Method ${message.method} is not a tracked method on object with id ${this.objectId}.`));
      return;
    }
    if (!checkCanApplyProperty(this.instance.constructor, this.instance, message.method, true, clientToken)) {
      finishInvoke(null, new Error("Not allowed."));
      return;
    }
    let resultOrPromise;
    try {
      const parameters = message.parameters.map((value, index) => {
        return this.deserializeValue(value, clientToken, methodInfo.allowedParameterTypesFromSender ? methodInfo.allowedParameterTypesFromSender[index] ?? [] : void 0);
      });
      resultOrPromise = method.apply(this.instance, parameters);
    } catch (e) {
      finishInvoke(null, e);
      return;
    }
    if (isPromiseLike(resultOrPromise)) {
      const promise = resultOrPromise.then((result) => {
        finishInvoke(result, null);
      }, (error) => {
        finishInvoke(null, error);
      });
      const promiseHandlingType = getSyncMethodInfo(this.instance.constructor, message.method)?.promiseHandlingType ?? "normal";
      if (promiseHandlingType === "await") {
        this._objectInfo.owner.registerPendingPromise(promise);
      }
    } else {
      finishInvoke(resultOrPromise, null);
    }
  }
  onExecuteFinishedMessageReceived(message, clientToken) {
    const pendingCall = this._pendingInvokeMethodInfosById.get(message.invokeId);
    if (!pendingCall)
      return;
    const clientPromiseInfo = pendingCall.invokeMethodInfoByClient.get(clientToken);
    if (!clientPromiseInfo)
      return;
    if ("error" in message) {
      clientPromiseInfo.reject(message.error);
    } else {
      clientPromiseInfo.resolve(message.result);
    }
  }
  generateCreateMessage(typeId, clientToken) {
    const data = {};
    const propertiesToOmit = /* @__PURE__ */ new Set();
    if (this._typeInfo.constructorArguments !== void 0) {
      const constructorArgumentsResult = typeof this._typeInfo.constructorArguments === "function" ? this._typeInfo.constructorArguments.call(this.instance, { instance: this.instance, constructor: this.type, typeId, destinationClientToken: clientToken }) : this._typeInfo.constructorArguments;
      const finalConstructorArguments = data[constructorPropertyName] = [];
      if (Array.isArray(constructorArgumentsResult)) {
        constructorArgumentsResult.forEach((propertyKey) => {
          propertiesToOmit.add(propertyKey);
          const propertyValueInfo = this._properties.get(propertyKey);
          if (!propertyValueInfo) {
            throw new Error(`Cannot use property '${propertyKey}' as constructor argument for type '${this._typeId}' because it is not a tracked property.`);
          }
          const value = propertyValueInfo.value;
          const beforeSendResult = beforeSendPropertyToClient(this.instance.constructor, this.instance, propertyKey, value, clientToken);
          if (beforeSendResult.skip)
            return;
          finalConstructorArguments.push(this.serializeValue({ value: beforeSendResult.value, key: propertyKey, clientToken }));
        });
      } else {
        if (constructorArgumentsResult.propertiesToOmit) {
          for (const prop of constructorArgumentsResult.propertiesToOmit) {
            propertiesToOmit.add(prop);
          }
        }
        constructorArgumentsResult.arguments.forEach((argument) => {
          const transformedValue = this.serializeValue(argument, clientToken);
          finalConstructorArguments.push(transformedValue);
        });
      }
    }
    this._properties.forEach((propertyValueInfo, propertyKey) => {
      if (propertiesToOmit.has(propertyKey))
        return;
      const value = propertyValueInfo.value;
      const beforeSendResult = beforeSendPropertyToClient(this.instance.constructor, this.instance, propertyKey, value, clientToken);
      if (beforeSendResult.skip)
        return;
      data[propertyKey] = this.serializeValue({ value: beforeSendResult.value, key: propertyKey, clientToken });
    });
    return this.createMessage("create", data, typeId);
  }
  generateChangeMessage(typeId, clientToken) {
    const data = {};
    let hasDataToSend = false;
    this._properties.forEach((propertyValueInfo, propertyKey) => {
      if (!propertyValueInfo.hasPendingChanges)
        return;
      const value = propertyValueInfo.value;
      const beforeSendResult = beforeSendPropertyToClient(this.instance.constructor, this.instance, propertyKey, value, clientToken);
      if (beforeSendResult.skip)
        return;
      const transformedValue = this.serializeValue({ value: beforeSendResult.value, key: propertyKey, clientToken });
      data[propertyKey] = transformedValue;
      hasDataToSend = true;
    });
    if (!hasDataToSend)
      return null;
    return this.createMessage("change", data);
  }
  generateMessages(clientToken, isNewClient) {
    const result = [];
    let typeId = this.getTypeId(clientToken);
    if (typeId === null) {
      return result;
    }
    if (isNewClient || this.hasPendingChanges) {
      if (isNewClient)
        result.push(this.generateCreateMessage(typeId, clientToken));
      else {
        const changeMessage = this.generateChangeMessage(typeId, clientToken);
        if (changeMessage)
          result.push(changeMessage);
      }
    }
    this.generateExecuteMessages(typeId, clientToken, result);
    this.generateExecuteResultMessages(typeId, clientToken, result);
    return result;
  }
  generateExecuteMessages(typeId, clientToken, result) {
    for (const pendingInvokeMethodInfos of this._pendingInvokeMethodInfosById.values()) {
      const clientInvokeInfo = pendingInvokeMethodInfos.invokeMethodInfoByClient.get(clientToken);
      if (!clientInvokeInfo || clientInvokeInfo.sentToClient)
        continue;
      clientInvokeInfo.sentToClient = true;
      const args = pendingInvokeMethodInfos.parameters.slice();
      if (beforeExecuteOnClient(this.instance.constructor, this.instance, pendingInvokeMethodInfos.methodName, args, clientToken) === false) {
        clientInvokeInfo.reject("Not allowed to invoke method.");
        continue;
      }
      const parameters = args.map((arg) => {
        const transformedValue = this.serializeValue(arg, clientToken);
        return transformedValue;
      });
      const executeMessage = this.createMessage("execute", {
        invokeId: pendingInvokeMethodInfos.id,
        method: pendingInvokeMethodInfos.methodName,
        parameters
      });
      result.push(executeMessage);
    }
  }
  generateExecuteResultMessages(typeId, clientToken, result) {
    const methodInvokeResults = this._methodInvokeResultsByClient.get(clientToken);
    if (methodInvokeResults) {
      this._methodInvokeResultsByClient.delete(clientToken);
      for (const methodInvokeResult of methodInvokeResults ?? []) {
        const executeFinishedMessage = this.createMessage("executeFinished", {
          invokeId: methodInvokeResult.invokeId
        });
        if ("result" in methodInvokeResult)
          executeFinishedMessage.result = this.serializeValue(methodInvokeResult.result, clientToken);
        if ("error" in methodInvokeResult)
          executeFinishedMessage.error = this.serializeValue(methodInvokeResult.error, clientToken);
        result.push(executeFinishedMessage);
      }
    }
  }
  getTypeId(clientToken) {
    const typeIdOrNothing = beforeSendObjectToClient(this.type, this.instance, this._typeId, clientToken);
    if (typeIdOrNothing === nothing)
      return null;
    return typeIdOrNothing;
  }
  reportPropertyChanged(propertyInfo, key, value) {
    if (!this.checkCanTrackPropertyInfo(propertyInfo, this.instance, key))
      return;
    let property = this._properties.get(key);
    if (!property) {
      property = {
        hasPendingChanges: true,
        value: void 0,
        propertyInfo
      };
      this._properties.set(key, property);
      this.hasPendingChanges = true;
    }
    if (property.value === value)
      return;
    this.clearStoredReferences(key);
    property.value = value;
    if (this.isApplyingMessages)
      return;
    else {
      const self = this;
      property.propertyInfo.afterValueChanged?.call(this.instance, {
        instance: this.instance,
        key,
        value,
        sourceClientToken: null,
        get syncAgent() {
          return self._objectInfo.owner.getSyncAgentOrNull(value);
        }
      });
    }
    property.hasPendingChanges = true;
    this.hasPendingChanges = true;
  }
  clearStates(clientToken) {
    super.clearStates(clientToken);
    if (clientToken) {
      this._methodInvokeResultsByClient.delete(clientToken);
    } else {
      this._properties.forEach((property) => {
        property.hasPendingChanges = false;
      });
    }
  }
  checkCanTrackPropertyInfo(propertyInfo, instance, propertyKey) {
    if (!propertyInfo) {
      return false;
    }
    if (propertyInfo.canTrack?.call(instance, { instance, key: propertyKey }) === false) {
      return false;
    }
    return true;
  }
  invoke(clientOrClientsOrMethodName, ...args) {
    if (typeof clientOrClientsOrMethodName === "string") {
      const methodName = clientOrClientsOrMethodName;
      return this.invokeMethodForClients(void 0, methodName, ...args);
    } else {
      const clientOrClients = clientOrClientsOrMethodName;
      const methodName = args.shift();
      const result = this.invokeMethodForClients(clientOrClients, methodName, ...args);
      if (isIterable(clientOrClients)) {
        return result;
      } else {
        const client = clientOrClients;
        return result.get(client);
      }
    }
  }
  invokeMethodForClients(clientOrClients, methodName, ...parameters) {
    const clients = clientOrClients ?? this._objectInfo.owner.registeredClientTokens;
    const methodInfo = this._typeInfo.trackedMethods.get(methodName);
    if (!methodInfo) {
      throw new Error(`Cannot invoke method '${methodName}' on object with id ${this.objectId} because it is not a tracked method.`);
    }
    const resultByClient = /* @__PURE__ */ new Map();
    if (!this.checkCanTrackPropertyInfo(methodInfo, this.instance, methodName)) {
      forEachIterable(clients, (c) => {
        resultByClient.set(c, Promise.reject(new Error(`Not allowed to invoke method ${methodName} on object ${this.objectId}.`)));
      });
      return resultByClient;
    }
    const id = this._nextInvokeId++;
    const invokeMethodInfo = {
      id,
      methodName,
      parameters,
      invokeMethodInfoByClient: /* @__PURE__ */ new Map()
    };
    forEachIterable(clients, (clientToken) => {
      const onPromiseFinished = () => {
        invokeMethodInfo.invokeMethodInfoByClient.delete(clientToken);
        if (invokeMethodInfo.invokeMethodInfoByClient.size === 0) {
          this._pendingInvokeMethodInfosById.delete(id);
        }
      };
      const promise = new Promise((res, rej) => {
        invokeMethodInfo.invokeMethodInfoByClient.set(clientToken, {
          resolve: (data) => {
            onPromiseFinished();
            const result = this.deserializeValue(data, clientToken, methodInfo.allowedReturnTypesFromSender);
            res(result);
          },
          reject: (data) => {
            onPromiseFinished();
            const error = this.deserializeValue(data, clientToken, methodInfo.allowedRejectionTypesFromSender);
            rej(error);
          },
          sentToClient: false
        });
      });
      resultByClient.set(clientToken, promise);
    });
    this._pendingInvokeMethodInfosById.set(invokeMethodInfo.id, invokeMethodInfo);
    this.reportPendingMessages();
    return resultByClient;
  }
};

// build/shared/decorators.js
Symbol.metadata ?? (Symbol.metadata = Symbol("metadata"));

// build/syncAgents/agents/array/metaInfo.js
var SyncArrayMetaInfo = class extends MetaInfo {
  reportSplice(instance, change) {
    this.emit("spliced", instance, change);
  }
};

// build/syncAgents/agents/array/syncableArray.js
var realInstanceSymbol = Symbol("realInstanceSymbol");
var ignoreSyncSpliceCounterByInstance = /* @__PURE__ */ new Map();
var SyncableArray = class extends Array {
  constructor(...initialData) {
    super(...initialData);
    const that = this;
    const proxy = new Proxy(this, {
      get(target, prop, receiver) {
        if (prop === realInstanceSymbol) {
          return that;
        }
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver) {
        const isIndexer = (typeof prop === "string" || typeof prop === "number") && !isNaN(Number(prop));
        if (isIndexer)
          return that.setAtIndex.call(receiver, Number(prop), value);
        if (prop === "length") {
          target.setLength.call(receiver, value);
          return true;
        }
        return Reflect.set(target, prop, value, receiver);
      }
    });
    return proxy;
  }
  setLength(value) {
    if (value >= 0 && !isIgnoringSpliceGathering(this)) {
      const oldLength = this.length;
      if (value < oldLength) {
        const spliceInstruction = {
          start: value,
          deletedItems: this.slice(value, oldLength),
          items: []
        };
        this.onSplice(spliceInstruction);
      } else if (value > oldLength) {
        const spliceInstruction = {
          start: oldLength,
          deletedItems: [],
          items: new Array(value - oldLength).fill(void 0)
        };
        this.onSplice(spliceInstruction);
      }
    }
    withIgnoredSyncSplice(this, () => {
      super.length = value;
    });
  }
  setAtIndex(index, value) {
    if (index >= 0 && !isIgnoringSpliceGathering(this)) {
      const spliceInstruction = {
        start: index,
        deletedItems: this.slice(index, index + 1),
        items: [value]
      };
      this.onSplice(spliceInstruction);
    }
    withIgnoredSyncSplice(this, () => {
      super[index] = value;
    });
    return true;
  }
  splice(start, deleteCount, ...items) {
    const actualStart = typeof start === "number" ? start : 0;
    const actualDeleteCount = typeof deleteCount === "number" ? deleteCount : this.length - actualStart;
    const deletedItems = withIgnoredSyncSplice(this, () => {
      return super.splice(actualStart, actualDeleteCount, ...items);
    });
    if (!isIgnoringSpliceGathering(this)) {
      const spliceInstruction = {
        start: actualStart,
        deletedItems,
        items
      };
      this.onSplice(spliceInstruction);
    }
    return deletedItems;
  }
  push(...items) {
    if (!isIgnoringSpliceGathering(this)) {
      const start = this.length;
      const spliceInstruction = {
        start,
        deletedItems: [],
        items
      };
      this.onSplice(spliceInstruction);
    }
    return withIgnoredSyncSplice(this, () => {
      return super.push(...items);
    });
  }
  pop() {
    if (this.length === 0)
      return void 0;
    if (!isIgnoringSpliceGathering(this)) {
      const start = this.length - 1;
      const spliceInstruction = {
        start,
        deletedItems: this.slice(start, start + 1),
        items: []
      };
      this.onSplice(spliceInstruction);
    }
    return withIgnoredSyncSplice(this, () => {
      return super.pop();
    });
  }
  shift() {
    if (this.length === 0)
      return void 0;
    if (!isIgnoringSpliceGathering(this)) {
      const spliceInstruction = {
        start: 0,
        deletedItems: this.slice(0, 1),
        items: []
      };
      this.onSplice(spliceInstruction);
    }
    return withIgnoredSyncSplice(this, () => {
      return super.shift();
    });
  }
  unshift(...items) {
    if (!isIgnoringSpliceGathering(this)) {
      const spliceInstruction = {
        start: 0,
        deletedItems: [],
        items
      };
      this.onSplice(spliceInstruction);
    }
    return withIgnoredSyncSplice(this, () => {
      return super.unshift(...items);
    });
  }
  reverse() {
    const result = withIgnoredSyncSplice(this, () => {
      return super.reverse();
    });
    if (!isIgnoringSpliceGathering(this)) {
      const spliceInstruction = {
        start: 0,
        deletedItems: this.slice(0, this.length),
        items: [...this]
      };
      this.onSplice(spliceInstruction);
    }
    return result;
  }
  sort(compareFn) {
    const result = withIgnoredSyncSplice(this, () => {
      return super.sort(compareFn);
    });
    if (!isIgnoringSpliceGathering(this)) {
      const spliceInstruction = {
        start: 0,
        deletedItems: this.slice(0, this.length),
        items: [...this]
      };
      this.onSplice(spliceInstruction);
    }
    return result;
  }
  fill(value, start, end) {
    const actualStart = start !== void 0 ? start : 0;
    const actualEnd = end !== void 0 ? end : this.length;
    const result = withIgnoredSyncSplice(this, () => {
      return super.fill(value, start, end);
    });
    var itemsFromData = this.slice(actualStart, actualEnd);
    if (!isIgnoringSpliceGathering(this)) {
      const spliceInstruction = {
        start: actualStart,
        deletedItems: this.slice(actualStart, actualEnd),
        items: itemsFromData
      };
      this.onSplice(spliceInstruction);
    }
    return result;
  }
  copyWithin(target, start, end) {
    const actualEnd = end !== void 0 ? end : this.length;
    const result = withIgnoredSyncSplice(this, () => {
      return super.copyWithin(target, start, end);
    });
    var itemsFromData = this.slice(target, target + (actualEnd - start));
    if (!isIgnoringSpliceGathering(this)) {
      const spliceInstruction = {
        start: target,
        deletedItems: this.slice(target, target + (actualEnd - start)),
        items: itemsFromData
      };
      this.onSplice(spliceInstruction);
    }
    return result;
  }
  onSplice(spliceInstruction) {
    getMetaInfo(this, SyncArrayMetaInfo)?.reportSplice(this, spliceInstruction);
  }
};
function withIgnoredSyncSplice(instance, action) {
  const realInstance = instance[realInstanceSymbol] ?? instance;
  const cnt = ignoreSyncSpliceCounterByInstance.get(realInstance) ?? 0;
  ignoreSyncSpliceCounterByInstance.set(realInstance, cnt + 1);
  try {
    return action();
  } finally {
    const cnt2 = ignoreSyncSpliceCounterByInstance.get(realInstance) ?? 1;
    if (cnt2 <= 1) {
      ignoreSyncSpliceCounterByInstance.delete(realInstance);
    } else {
      ignoreSyncSpliceCounterByInstance.set(realInstance, cnt2 - 1);
    }
  }
}
function isIgnoringSpliceGathering(instance) {
  const realInstance = instance[realInstanceSymbol] ?? instance;
  const cnt = ignoreSyncSpliceCounterByInstance.get(realInstance) ?? 0;
  return cnt > 0;
}

// build/syncAgents/agents/array/syncableObservableArray.js
var SyncableObservableArray = class extends SyncableArray {
  constructor() {
    super(...arguments);
    __publicField(this, "_eventEmitter", new EventEmitter());
  }
  onSplice(spliceInstruction) {
    super.onSplice(spliceInstruction);
    if (spliceInstruction.deletedItems.length > 0 && this._eventEmitter.listenerCount("removed") > 0) {
      this._eventEmitter.emit("removed", spliceInstruction.deletedItems, spliceInstruction.start);
    }
    if (spliceInstruction.items.length > 0 && this._eventEmitter.listenerCount("added") > 0) {
      this._eventEmitter.emit("added", spliceInstruction.items, spliceInstruction.start);
    }
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
};

// build/syncAgents/agents/base.js
function createSyncAgentProvider(baseClass, constructor, typeId, isIntrinsic) {
  const TypedSyncAgent = class extends baseClass {
    constructor(objectInfo) {
      super(constructor, typeId, objectInfo);
    }
  };
  const syncAgentProvider = new SyncAgentProvider({
    syncAgentType: TypedSyncAgent,
    syncType: constructor,
    typeId,
    isIntrinsic
  });
  return syncAgentProvider;
}

// build/syncAgents/agents/array/changeSet.js
var Span = class _Span {
  constructor(dataOrSpan, start = 0, length) {
    __publicField(this, "_data");
    __publicField(this, "end");
    __publicField(this, "start");
    if (dataOrSpan instanceof _Span) {
      this._data = dataOrSpan._data;
      this.start = dataOrSpan.start + start;
      this.end = length !== void 0 ? this.start + length - 1 : dataOrSpan.end;
    } else {
      this._data = dataOrSpan;
      this.start = start;
      this.end = (length !== void 0 ? this.start + length : dataOrSpan.length) - 1;
    }
    if (this.length > this._data.length) {
      this.end = this._data.length - 1;
    }
  }
  get length() {
    return this.end - this.start + 1;
  }
  get(index) {
    return this._data[this.start + index];
  }
  get data() {
    return this._data.slice(this.start, this.end + 1);
  }
  subSpan(start, length) {
    return new _Span(this._data, this.start + start, Math.min(length, this.length - start));
  }
  dataFromRange(start, length) {
    return this._data.slice(this.start + start, this.start + start + length);
  }
};
function createChangeSet(before, after, startIndex = 0) {
  let beforeSpan = new Span(before);
  let afterSpan = new Span(after);
  let start = startIndex;
  if (beforeSpan.length === 0)
    return [{ start, deleteCount: 0, items: afterSpan.data }];
  if (afterSpan.length === 0)
    return [{ start, deleteCount: beforeSpan.length, items: [] }];
  const preprocessed = preprocessSpans(beforeSpan, afterSpan);
  if (preprocessed.isIdentical)
    return [];
  const results = [];
  while (true) {
    const nextMatch = findMatchInIndexMaps(preprocessed.spanAndIndexMap0, preprocessed.spanAndIndexMap1);
    if (!nextMatch)
      break;
    const [indexInBefore, indexInAfter, skipCount] = nextMatch;
    if (indexInBefore === 0 && indexInAfter === 0) {
      beforeSpan.start += skipCount;
      afterSpan.start += skipCount;
      start += skipCount;
      continue;
    }
    results.push({ start, deleteCount: indexInBefore, items: afterSpan.dataFromRange(0, indexInAfter) });
    afterSpan.start += indexInAfter + skipCount - 1;
    beforeSpan.start += indexInBefore + skipCount - 1;
    start += indexInAfter + skipCount - 1;
  }
  if (beforeSpan.length > 0 || afterSpan.length > 0)
    results.push({ start, deleteCount: beforeSpan.length, items: afterSpan.data });
  return results;
}
function applyChangeSet(array, changeSet) {
  for (const change of changeSet) {
    if (change.start > array.length && change.items.length > 0) {
      array[change.start] = void 0;
    }
    array.splice(change.start, change.deleteCount, ...change.items);
  }
  return array;
}
function preprocessSpans(span0, span1) {
  const sameLength = span0.length === span1.length;
  let isIdentical = sameLength;
  const indexMap0 = /* @__PURE__ */ new Map();
  const indexMap1 = /* @__PURE__ */ new Map();
  for (let inSpanIndex = 0; inSpanIndex < span0.length; inSpanIndex++) {
    const item0 = span0.get(inSpanIndex);
    storeSpanItemInIndexMap(span0, indexMap0, inSpanIndex, item0);
    if (sameLength) {
      var item1 = span1.get(inSpanIndex);
      storeSpanItemInIndexMap(span1, indexMap1, inSpanIndex, item1);
      if (isIdentical && item0 !== item1)
        isIdentical = false;
    }
  }
  if (isIdentical) {
    return { isIdentical: true };
  }
  if (!sameLength) {
    for (let inSpanIndex = 0; inSpanIndex < span1.length; inSpanIndex++) {
      const item12 = span1.get(inSpanIndex);
      storeSpanItemInIndexMap(span1, indexMap1, inSpanIndex, item12);
    }
  }
  return {
    spanAndIndexMap0: {
      span: span0,
      indexMap: indexMap0
    },
    spanAndIndexMap1: {
      span: span1,
      indexMap: indexMap1
    },
    isIdentical
  };
}
function storeSpanItemInIndexMap(span, indexMap, inSpanIndex, item) {
  if (!indexMap.has(item))
    indexMap.set(item, []);
  indexMap.get(item).push(inSpanIndex + span.start);
}
function findMatchInIndexMaps(spanAndIndexMap0, spanAndIndexMap1) {
  const threshold0 = spanAndIndexMap0.span.start;
  const threshold1 = spanAndIndexMap1.span.start;
  for (let i = 0; i < spanAndIndexMap0.span.length; i++) {
    const item = spanAndIndexMap0.span.get(i);
    const indicesInMap0 = spanAndIndexMap0.indexMap.get(item);
    if (!indicesInMap0)
      continue;
    const indicesInMap1 = spanAndIndexMap1.indexMap.get(item);
    if (!indicesInMap1)
      continue;
    for (const indexInMap0 of indicesInMap0) {
      if (indexInMap0 < threshold0)
        continue;
      for (const indexInMap1 of indicesInMap1) {
        if (indexInMap1 < threshold1)
          continue;
        let countOfMatchingItems = 0;
        while (indexInMap0 + countOfMatchingItems <= spanAndIndexMap0.span.end && indexInMap1 + countOfMatchingItems <= spanAndIndexMap1.span.end && spanAndIndexMap0.span.get(indexInMap0 + countOfMatchingItems - threshold0) === spanAndIndexMap1.span.get(indexInMap1 + countOfMatchingItems - threshold1)) {
          countOfMatchingItems++;
        }
        return [indexInMap0 - threshold0, indexInMap1 - threshold1, countOfMatchingItems];
      }
    }
  }
}

// build/syncAgents/agents/array/agent.js
var TYPE_ID_NATIVEARRAY = "<nativeArray>";
var TYPE_ID_SYNCARRAY = "<syncArray>";
var TYPE_ID_OBSERVABLEARRAY = "<syncObservableArray>";
var SyncableArraySyncAgentBase = class extends ExtendedSyncAgent {
  constructor(_arrayType, _typeId, objectInfo) {
    super(objectInfo);
    __publicField(this, "_arrayType");
    __publicField(this, "_typeId");
    __publicField(this, "_oldArrayContent", []);
    __publicField(this, "_temporaryChanges", null);
    __publicField(this, "_changeSetMode");
    __publicField(this, "_allowedTypesFromSender");
    this._arrayType = _arrayType;
    this._typeId = _typeId;
  }
  getTypeId(clientToken) {
    return this._typeId;
  }
  onInstanceSet(createdByCreateObjectMessage) {
    super.onInstanceSet(createdByCreateObjectMessage);
    const metaInfo = getMetaInfo(this.instance, SyncArrayMetaInfo, true);
    metaInfo?.on("spliced", (instance, change) => {
      this.reportSplice(change.start, change.deletedItems.length, ...change.items);
    });
    if (createdByCreateObjectMessage)
      return;
  }
  reportSplice(...args) {
    if (this.isApplyingMessages) {
      return;
    }
    if (args.length === 0 && this.changeSetMode !== "compareStates") {
      throw new Error("reportSplice requires parameters when arrayChangeSetMode is not 'compareStates'.");
    }
    this.reportSpliceInternal(...args);
  }
  reportSpliceInternal(start, deleteCount, ...items) {
    this.hasPendingChanges = true;
    if (this.changeSetMode === "trackSplices") {
      if (!this._temporaryChanges)
        this._temporaryChanges = [];
      this._temporaryChanges.push({
        start,
        deleteCount,
        items
      });
    } else {
      this._temporaryChanges = null;
    }
  }
  get changeSetMode() {
    return this._changeSetMode ?? this._objectInfo.owner.arrayChangeSetMode;
  }
  set changeSetMode(value) {
    this._changeSetMode = value;
  }
  get allowedTypesFromSender() {
    return this._allowedTypesFromSender;
  }
  set allowedTypesFromSender(value) {
    this._allowedTypesFromSender = value;
  }
  onCreateMessageReceived(message, clientToken) {
    this.instance = new this._arrayType();
    this.instance.push(...message.data.map((value) => this.deserializeValue(value, clientToken, this.allowedTypesFromSender)));
  }
  onChangeMessageReceived(message, clientToken) {
    const deserializedSplices = message.data.map((change) => ({
      start: change.start,
      deleteCount: change.deleteCount,
      items: change.items.map((item) => this.deserializeValue(item, clientToken))
    }));
    applyChangeSet(this.instance, deserializedSplices);
  }
  generateMessages(clientToken, isNewClient) {
    const messages = [];
    if (isNewClient || this.hasPendingChanges) {
      if (!this._temporaryChanges && this.changeSetMode === "compareStates") {
        this._temporaryChanges = createChangeSet(this._oldArrayContent, this.instance);
      }
    }
    if (isNewClient) {
      this.clearStoredReferences(clientToken);
      const data = this.instance.map((element, index) => this.serializeValue({
        clientToken,
        value: element,
        key: index
      }));
      messages.push(this.createMessage("create", data, clientToken));
    } else if (this.hasPendingChanges) {
      const data = this._temporaryChanges.map((change) => {
        for (let i = change.items.length; i < change.deleteCount; i++) {
          this.clearStoredReferences(change.start + i, clientToken);
        }
        return {
          start: change.start,
          deleteCount: change.deleteCount,
          items: change.items.map((item, itemIndex) => this.serializeValue({ value: item, key: change.start + itemIndex, clientToken }))
        };
      });
      messages.push(this.createMessage("change", data));
    }
    return messages;
  }
  clearStates(clientToken) {
    super.clearStates(clientToken);
    if (!clientToken) {
      this._oldArrayContent = this.instance.slice();
      this._temporaryChanges = null;
    }
  }
};
var SyncableObservableArraySyncAgentProvider = createSyncAgentProvider(SyncableArraySyncAgentBase, SyncableObservableArray, TYPE_ID_OBSERVABLEARRAY, false);
var SyncableArraySyncAgentProvider = createSyncAgentProvider(SyncableArraySyncAgentBase, SyncableArray, TYPE_ID_SYNCARRAY, false);
var ArraySyncAgentProvider = createSyncAgentProvider(SyncableArraySyncAgentBase, Array, TYPE_ID_NATIVEARRAY, true);

// build/syncAgents/agents/map/metaInfo.js
var SyncMapMetaInfo = class extends MetaInfo {
  reportClear(instance) {
    this.emit("cleared", instance);
  }
  reportDelete(instance, key) {
    this.emit("deleted", instance, key);
  }
  reportChange(instance, key, value) {
    this.emit("changed", instance, key, value);
  }
};

// build/syncAgents/agents/map/syncableMap.js
var SyncableMap = class extends Map {
  constructor(iterable) {
    super(iterable);
  }
  set(key, value) {
    super.set(key, value);
    getMetaInfo(this, SyncMapMetaInfo)?.reportChange(this, key, value);
    return this;
  }
  clear() {
    super.clear();
    getMetaInfo(this, SyncMapMetaInfo)?.reportClear(this);
  }
  delete(key) {
    const result = super.delete(key);
    if (result) {
      getMetaInfo(this, SyncMapMetaInfo)?.reportDelete(this, key);
    }
    return result;
  }
};

// build/syncAgents/agents/map/syncableObservableMap.js
var SyncableObservableMap = class extends SyncableMap {
  constructor() {
    super(...arguments);
    __publicField(this, "_eventEmitter", new EventEmitter());
  }
  set(key, value) {
    super.set(key, value);
    this._eventEmitter.emit("set", key, value);
    return this;
  }
  clear() {
    super.clear();
    this._eventEmitter.emit("cleared");
  }
  delete(key) {
    const result = super.delete(key);
    if (result) {
      this._eventEmitter.emit("deleted", key);
    }
    return result;
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
};

// build/syncAgents/agents/map/agent.js
var TYPE_ID_NATIVEMAP = "<nativeMap>";
var TYPE_ID_SYNCABLEMAP = "<syncableMap>";
var TYPE_ID_SYNCABLEOBSERVABLEMAP = "<syncableObservableMap>";
var SyncableMapSyncAgentBase = class extends ExtendedSyncAgent {
  constructor(_mapType, _typeId, objectInfo) {
    super(objectInfo);
    __publicField(this, "_mapType");
    __publicField(this, "_typeId");
    __publicField(this, "_changes", []);
    __publicField(this, "_allowedKeyTypesFromSender");
    __publicField(this, "_allowedValueTypesFromSender");
    this._mapType = _mapType;
    this._typeId = _typeId;
  }
  get allowedKeyTypesFromSender() {
    return this._allowedKeyTypesFromSender;
  }
  set allowedKeyTypesFromSender(value) {
    this._allowedKeyTypesFromSender = value;
  }
  get allowedValueTypesFromSender() {
    return this._allowedValueTypesFromSender;
  }
  set allowedValueTypesFromSender(value) {
    this._allowedValueTypesFromSender = value;
  }
  getTypeId(clientToken) {
    return this._typeId;
  }
  onInstanceSet(createdByCreateObjectMessage) {
    super.onInstanceSet(createdByCreateObjectMessage);
    const metaInfo = getMetaInfo(this.instance, SyncMapMetaInfo, true);
    metaInfo?.on("changed", (instance, key, value) => {
      this.reportChange(key, value);
    });
    metaInfo?.on("cleared", (instance) => {
      this.reportClear();
    });
    metaInfo?.on("deleted", (instance, key) => {
      this.reportDelete(key);
    });
  }
  reportClear() {
    if (this.isApplyingMessages)
      return;
    this._changes.length = 0;
    this._changes.push({ clear: true });
    this.hasPendingChanges = true;
  }
  reportChange(key, value) {
    if (this.isApplyingMessages)
      return;
    this._changes.push({ key, value });
    this.hasPendingChanges = true;
  }
  reportDelete(key) {
    if (this.isApplyingMessages)
      return;
    this._changes = this._changes.filter((change) => "key" in change && change.key !== key);
    this._changes.push({ key, delete: true });
    this.hasPendingChanges = true;
  }
  onCreateMessageReceived(message, clientToken) {
    this.instance = new this._mapType();
    for (const { key, value } of message.data) {
      const deserializedKey = this.deserializeValue(key, clientToken, this.allowedKeyTypesFromSender);
      const deserializedValue = this.deserializeValue(value, clientToken, this.allowedValueTypesFromSender);
      this.instance.set(deserializedKey, deserializedValue);
    }
  }
  onChangeMessageReceived(message, clientToken) {
    for (const change of message.data) {
      if ("clear" in change) {
        this.instance.clear();
        continue;
      } else if ("delete" in change) {
        const deserializedKey = this.deserializeValue(change.key, clientToken, this.allowedKeyTypesFromSender);
        this.instance.delete(deserializedKey);
        continue;
      } else {
        const deserializedKey = this.deserializeValue(change.key, clientToken, this.allowedKeyTypesFromSender);
        const deserializedValue = this.deserializeValue(change.value, clientToken, this.allowedValueTypesFromSender);
        this.instance.set(deserializedKey, deserializedValue);
      }
    }
  }
  generateMessages(clientToken, isNewClient) {
    if (isNewClient)
      return [this.createMessage("create", this.getCreationData(clientToken), clientToken)];
    else if (this.hasPendingChanges)
      return [this.createMessage("change", this.getChangeData(clientToken))];
    return [];
  }
  getChangeData(clientToken) {
    return this._changes.map((change) => {
      if ("clear" in change) {
        this.clearStoredReferences(clientToken);
        return { clear: true };
      } else if ("delete" in change) {
        this.clearStoredReferences(change.key, clientToken);
        const serializedKey = this.serializeValue(change.key, clientToken);
        return { key: serializedKey, delete: true };
      } else {
        this.storeReference({
          clientToken,
          key: change.key,
          values: [change.key, change.value]
        });
        const [key, value] = this.serializeValue({
          clientToken,
          key: change.key,
          values: [change.key, change.value]
        });
        return { key, value };
      }
    });
  }
  getCreationData(clientToken) {
    this.clearStoredReferences(clientToken);
    const data = [];
    for (const [key, value] of this.instance) {
      this.storeReference({
        clientToken,
        key,
        values: [key, value]
      });
      const serializedKey = this.serializeValue(key, clientToken);
      const serializedValue = this.serializeValue(value, clientToken);
      data.push({ key: serializedKey, value: serializedValue });
    }
    return data;
  }
  clearStates(clientToken) {
    super.clearStates(clientToken);
    if (!clientToken)
      this._changes.length = 0;
  }
};
var SyncableObservableMapSyncAgentProvider = createSyncAgentProvider(SyncableMapSyncAgentBase, SyncableObservableMap, TYPE_ID_SYNCABLEOBSERVABLEMAP, false);
var SyncableMapSyncAgentProvider = createSyncAgentProvider(SyncableMapSyncAgentBase, SyncableMap, TYPE_ID_SYNCABLEMAP, false);
var MapSyncAgentProvider = createSyncAgentProvider(SyncableMapSyncAgentBase, Map, TYPE_ID_NATIVEMAP, true);

// build/syncAgents/agents/set/metaInfo.js
var SyncableSetMetaInfo = class extends MetaInfo {
  reportClear(instance) {
    this.emit("cleared", instance);
  }
  reportDelete(instance, value) {
    this.emit("deleted", instance, value);
  }
  reportAdd(instance, value) {
    this.emit("added", instance, value);
  }
};

// build/syncAgents/agents/set/syncableSet.js
var SyncableSet = class extends Set {
  constructor(iterable) {
    super(iterable);
  }
  add(value) {
    const alreadyHas = this.has(value);
    super.add(value);
    if (!alreadyHas) {
      getMetaInfo(this, SyncableSetMetaInfo)?.reportAdd(this, value);
    }
    return this;
  }
  clear() {
    super.clear();
    getMetaInfo(this, SyncableSetMetaInfo)?.reportClear(this);
  }
  delete(value) {
    const result = super.delete(value);
    if (result) {
      getMetaInfo(this, SyncableSetMetaInfo)?.reportDelete(this, value);
    }
    return result;
  }
};

// build/syncAgents/agents/set/syncableObservableSet.js
var SyncableObservableSet = class extends SyncableSet {
  constructor() {
    super(...arguments);
    __publicField(this, "_eventEmitter", new EventEmitter());
  }
  add(value) {
    super.add(value);
    this._eventEmitter.emit("added", value);
    return this;
  }
  clear() {
    super.clear();
    this._eventEmitter.emit("cleared");
  }
  delete(value) {
    const result = super.delete(value);
    if (result) {
      this._eventEmitter.emit("deleted", value);
    }
    return result;
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
};

// build/syncAgents/agents/set/agent.js
var TYPE_ID_NATIVESET = "<nativeSet>";
var TYPE_ID_SYNCABLESET = "<syncableSet>";
var TYPE_ID_SYNCABLEOBSERVABLESET = "<syncableObservableSet>";
var SyncableSetSyncAgentBase = class extends ExtendedSyncAgent {
  constructor(_setType, _typeId, objectInfo) {
    super(objectInfo);
    __publicField(this, "_setType");
    __publicField(this, "_typeId");
    __publicField(this, "_changes", []);
    __publicField(this, "_allowedTypesFromSender");
    this._setType = _setType;
    this._typeId = _typeId;
  }
  get allowedTypesFromSender() {
    return this._allowedTypesFromSender;
  }
  set allowedTypesFromSender(value) {
    this._allowedTypesFromSender = value;
  }
  getTypeId(clientToken) {
    return this._typeId;
  }
  onInstanceSet(createdByCreateObjectMessage) {
    super.onInstanceSet(createdByCreateObjectMessage);
    const metaInfo = getMetaInfo(this.instance, SyncableSetMetaInfo, true);
    metaInfo?.on("added", (instance, value) => {
      this.reportAdd(value);
    });
    metaInfo?.on("cleared", (instance) => {
      this.reportClear();
    });
    metaInfo?.on("deleted", (instance, value) => {
      this.reportDelete(value);
    });
  }
  reportClear() {
    if (this.isApplyingMessages)
      return;
    this._changes.length = 0;
    this._changes.push({ clear: true });
    this.hasPendingChanges = true;
  }
  reportAdd(value) {
    if (this.isApplyingMessages)
      return;
    this._changes = this._changes.filter((change) => "value" in change && change.value !== value);
    this._changes.push({ value });
    this.hasPendingChanges = true;
  }
  reportDelete(value) {
    if (this.isApplyingMessages)
      return;
    this._changes = this._changes.filter((change) => "value" in change && change.value !== value);
    this._changes.push({ value, delete: true });
    this.hasPendingChanges = true;
  }
  onCreateMessageReceived(message, clientToken) {
    this.instance = new this._setType();
    for (const value of message.data) {
      const deserializedValue = this.deserializeValue(value, clientToken);
      this.instance.add(deserializedValue);
    }
  }
  onChangeMessageReceived(message, clientToken) {
    for (const change of message.data) {
      if ("clear" in change) {
        this.instance.clear();
        continue;
      } else if ("delete" in change) {
        const deserializedValue = this.deserializeValue(change.value, clientToken, this.allowedTypesFromSender);
        this.instance.delete(deserializedValue);
        continue;
      } else {
        const deserializedValue = this.deserializeValue(change.value, clientToken, this.allowedTypesFromSender);
        this.instance.add(deserializedValue);
      }
    }
  }
  generateMessages(clientToken, isNewClient) {
    if (isNewClient)
      return [this.createMessage("create", this.getCreationData(clientToken), clientToken)];
    else if (this.hasPendingChanges)
      return [this.createMessage("change", this.getChangeData(clientToken))];
    return [];
  }
  getChangeData(clientToken) {
    return this._changes.map((change) => {
      if ("clear" in change) {
        this.clearStoredReferences(clientToken);
        return { clear: true };
      } else if ("delete" in change) {
        this.clearStoredReferences(change.value, clientToken);
        const serializedValue = this.serializeValue(change.value, clientToken);
        return { value: serializedValue, delete: true };
      } else {
        const serializedValue = this.serializeValue({
          clientToken,
          key: change.value,
          value: change.value
        });
        return { value: serializedValue };
      }
    });
  }
  getCreationData(clientToken) {
    this.clearStoredReferences(clientToken);
    const data = [];
    for (const value of this.instance) {
      const serializedValue = this.serializeValue({ value, key: value, clientToken });
      data.push(serializedValue);
    }
    return data;
  }
  clearStates(clientToken) {
    super.clearStates(clientToken);
    if (!clientToken)
      this._changes.length = 0;
  }
};
var SyncableObservableSetSyncAgentProvider = createSyncAgentProvider(SyncableSetSyncAgentBase, SyncableObservableSet, TYPE_ID_SYNCABLEOBSERVABLESET, false);
var SyncableSetSyncAgentProvider = createSyncAgentProvider(SyncableSetSyncAgentBase, SyncableSet, TYPE_ID_SYNCABLESET, false);
var SetSyncAgentProvider = createSyncAgentProvider(SyncableSetSyncAgentBase, Set, TYPE_ID_NATIVESET, true);

// build/syncAgents/agents/error.js
var TYPE_ID = "<error>";
var ErrorSyncAgent = class extends ExtendedSyncAgent {
  static canSerialize(instanceOrTypeId) {
    if (typeof instanceOrTypeId === "string") {
      return instanceOrTypeId === TYPE_ID;
    }
    return instanceOrTypeId instanceof Error;
  }
  getTypeId(clientToken) {
    return TYPE_ID;
  }
  onCreateMessageReceived(message, clientToken) {
    switch (message.data.type) {
      case "EvalError":
        this.instance = new EvalError(message.data.message);
        break;
      case "RangeError":
        this.instance = new RangeError(message.data.message);
        break;
      case "ReferenceError":
        this.instance = new ReferenceError(message.data.message);
        break;
      case "SyntaxError":
        this.instance = new SyntaxError(message.data.message);
        break;
      case "TypeError":
        this.instance = new TypeError(message.data.message);
        break;
      case "URIError":
        this.instance = new URIError(message.data.message);
        break;
      case "AggregateError":
        this.instance = new AggregateError([], message.data.message);
        break;
      default:
        this.instance = new Error(message.data.message);
        if (this.instance.name !== message.data.name)
          this.instance.name = message.data.name;
        break;
    }
    if (message.data.errors) {
      message.data.errors.forEach((serializedValue) => {
        const deserializedError = this.deserializeValue(serializedValue, clientToken);
        this.instance.errors.push(deserializedError);
      });
    }
    if (message.data.stack)
      this.instance.stack = message.data.stack;
    if (message.data.cause)
      this.instance.cause = this.deserializeValue(message.data.cause, clientToken);
  }
  generateMessages(clientToken, isNewClient) {
    if (isNewClient) {
      return [this.createMessage("create", this.getCreationData(clientToken), clientToken)];
    }
    return [];
  }
  getCreationData(clientToken) {
    return {
      message: this.instance.message.toString(),
      name: this.instance.name.toString(),
      stack: this.instance.stack?.toString(),
      type: this.instance.constructor.name.toString(),
      errors: this.instance instanceof AggregateError ? this.instance.errors.filter((e) => e instanceof Error).map((e) => this.serializeValue(e, clientToken)) : void 0,
      cause: this.instance.cause instanceof Error ? this.serializeValue(this.instance.cause, clientToken) : void 0
    };
  }
};
var ErrorSyncAgentProviderClass = class extends SyncAgentProvider {
  constructor() {
    super({
      syncAgentType: ErrorSyncAgent,
      syncType: Error,
      typeId: TYPE_ID,
      isIntrinsic: true
    });
  }
};
var ErrorSyncAgentProvider = new ErrorSyncAgentProviderClass();

// build/syncAgents/agents/object.js
var TYPE_ID2 = "<object>";
var ObjectSyncAgent = class extends ExtendedSyncAgent {
  getTypeId(clientToken) {
    return TYPE_ID2;
  }
  onInstanceSet(createdByCreateObjectMessage) {
    super.onInstanceSet(createdByCreateObjectMessage);
  }
  onCreateMessageReceived(message, clientToken) {
    this.instance = {};
    this.onChangeMessageReceived(message, clientToken);
  }
  onChangeMessageReceived(message, clientToken) {
    for (const key of Object.keys(message.data)) {
      this.instance[key] = this.deserializeValue(message.data[key], clientToken);
    }
  }
  generateMessages(clientToken, isNewClient) {
    if (isNewClient)
      return [this.createMessage("create", this.getSerializedData(clientToken), clientToken)];
    else if (this.hasPendingChanges)
      return [this.createMessage("change", this.getSerializedData(clientToken))];
    return [];
  }
  getSerializedData(clientToken) {
    this.clearStoredReferences(clientToken);
    const data = {};
    for (const key of Object.keys(this.instance)) {
      const value = this.instance[key];
      data[key] = this.serializeValue({ value, key, clientToken });
    }
    return data;
  }
};
var ObjectSyncAgentProviderClass = class extends SyncAgentProvider {
  constructor() {
    super({
      syncAgentType: ObjectSyncAgent,
      syncType: Object,
      typeId: TYPE_ID2,
      isIntrinsic: true
    });
  }
};
var ObjectSyncAgentProvider = new ObjectSyncAgentProviderClass();

// build/syncAgents/objectInfo.js
var ObjectInfo = class {
  constructor(_owner, _objectId = null, instanceOrTypeId = null, _isRoot = false) {
    __publicField(this, "_owner");
    __publicField(this, "_objectId");
    __publicField(this, "_isRoot");
    __publicField(this, "_syncAgent", null);
    __publicField(this, "_instance", null);
    __publicField(this, "_isOwned", false);
    __publicField(this, "_referenceCountByClient", /* @__PURE__ */ new Map());
    this._owner = _owner;
    this._objectId = _objectId;
    this._isRoot = _isRoot;
    if (typeof instanceOrTypeId === "string") {
      this._objectId ?? (this._objectId = this._owner.generateObjectId());
    } else {
      this._instance = instanceOrTypeId;
      this._objectId ?? (this._objectId = this._owner.generateObjectId(this._instance));
    }
  }
  initializeSyncAgent(instanceOrTypeId = null) {
    const provider = this._owner.syncAgentProviders.findOrThrow(instanceOrTypeId);
    this._syncAgent = provider.createAgent(this);
    if (this._instance)
      this._syncAgent.onInstanceSet(false);
  }
  get isOwned() {
    return this._isOwned;
  }
  set isOwned(value) {
    this._isOwned = this._isOwned || value;
  }
  get objectId() {
    return this._objectId;
  }
  get instance() {
    return this._instance;
  }
  set instance(value) {
    if (value === this._instance)
      return;
    if (this._instance)
      throw new Error("Instance is already set and cannot be changed.");
    this._instance = value;
    this._owner.reportInstanceCreated(value, this._objectId);
  }
  get isRoot() {
    return this._isRoot;
  }
  set isRoot(value) {
    this._isRoot = value;
  }
  get syncAgent() {
    return this._syncAgent;
  }
  get owner() {
    return this._owner;
  }
  addReference(clientToken) {
    this._referenceCountByClient.set(clientToken, (this._referenceCountByClient.get(clientToken) ?? 0) + 1);
    return createDisposable(() => {
      this.removeReference(clientToken);
    });
  }
  get isOrphaned() {
    if (this._isRoot || !this._isOwned)
      return false;
    for (const count of this._referenceCountByClient.values()) {
      if (count > 0)
        return false;
    }
    return true;
  }
  mustDeleteForClient(clientToken) {
    return this._instance !== null && this._isOwned && !this._isRoot && this._syncAgent.clients.has(clientToken) && (this._referenceCountByClient.get(clientToken) ?? 0) <= 0;
  }
  removeReference(clientToken) {
    const currentCount = this._referenceCountByClient.get(clientToken);
    if (currentCount === void 0)
      return;
    if (currentCount <= 1) {
      this._referenceCountByClient.delete(clientToken);
    } else {
      this._referenceCountByClient.set(clientToken, currentCount - 1);
    }
  }
};

// build/syncAgents/decorators/syncAgent.js
function syncAgent(settings) {
  return function syncObject2(target, context) {
    context.addInitializer(function() {
      const provider = new SyncAgentProvider({
        syncAgentType: target,
        syncType: settings.type,
        typeId: settings.typeId ?? settings.type.name,
        matchExactType: true,
        isIntrinsic: "defaultIntrinsicSyncAgentProvider" in settings ? settings.defaultIntrinsicSyncAgentProvider : false
      });
    });
  };
}

// build/objectSync/objectPool.js
var ObjectPool = class {
  constructor() {
    __publicField(this, "_objectToInfo", /* @__PURE__ */ new Map());
    __publicField(this, "_objectIdToInfo", /* @__PURE__ */ new Map());
  }
  hasObject(instance) {
    return this._objectToInfo.has(instance);
  }
  hasObjectId(objectId) {
    return this._objectIdToInfo.has(objectId);
  }
  getInfoByObject(instance) {
    return this._objectToInfo.get(instance);
  }
  getObjectById(objectId) {
    return this._objectIdToInfo.get(objectId)?.instance;
  }
  getInfoById(objectId) {
    return this._objectIdToInfo.get(objectId);
  }
  get objects() {
    return Array.from(this._objectIdToInfo.values()).map((info) => info.instance);
  }
  get infos() {
    return Array.from(this._objectIdToInfo.values());
  }
  objectInfosToDelete(clientToken) {
    return this.infos.filter((info) => info.mustDeleteForClient(clientToken));
  }
  orphanedObjectInfos(clientToken) {
    return this.infos.filter((info) => info.isOrphaned);
  }
  get ownedObjects() {
    return this.infos.filter((info) => info.isOwned).map((info) => info.instance);
  }
  add(info) {
    const { instance, objectId } = info;
    if (instance)
      this._objectToInfo.set(instance, info);
    this._objectIdToInfo.set(objectId, info);
    return info;
  }
  deleteByObject(instance) {
    const info = this._objectToInfo.get(instance);
    if (info) {
      this._objectIdToInfo.delete(info.objectId);
      this._objectToInfo.delete(instance);
    }
  }
  deleteById(objectId) {
    const info = this._objectIdToInfo.get(objectId);
    if (info) {
      this._objectToInfo.delete(info.instance);
      this._objectIdToInfo.delete(objectId);
    }
  }
  onObjectSet(info) {
    this._objectToInfo.set(info.instance, info);
  }
  findOne(constructor, objectId, predicate) {
    return this.infos.find((info) => {
      return info.instance && info.instance instanceof constructor && (objectId === void 0 || info.objectId === objectId) && (predicate ? predicate(info) : true);
    })?.instance;
  }
  findAll(constructor, predicate) {
    return this.infos.filter((info) => {
      return (!constructor || info.instance && info.instance instanceof constructor) && (predicate ? predicate(info) : true);
    }).map((info) => info.instance);
  }
};

// build/objectSync/weakObjectPool.js
var WeakObjectPool = class extends EventEmitter {
  constructor() {
    super();
    __publicField(this, "_objectToInfoMap", /* @__PURE__ */ new WeakMap());
    __publicField(this, "_objectIdToWeakRefMap", /* @__PURE__ */ new Map());
    __publicField(this, "_finalizationRegistry");
    __publicField(this, "_objectIdClientTokens", /* @__PURE__ */ new Map());
    this._finalizationRegistry = new FinalizationRegistry((objectId) => {
      const clients = this._objectIdClientTokens.get(objectId) || /* @__PURE__ */ new Set();
      this._objectIdClientTokens.delete(objectId);
      this._objectIdToWeakRefMap.delete(objectId);
      this.emit("freed", objectId, clients);
    });
  }
  add(info) {
    this._objectToInfoMap.set(info.instance, info);
    this._objectIdToWeakRefMap.set(info.objectId, new WeakRef(info));
    this._finalizationRegistry.register(info.instance, info.objectId);
    this._objectIdClientTokens.set(info.objectId, info.syncAgent.clients);
  }
  delete(info) {
    this._objectToInfoMap.delete(info.instance);
    this._finalizationRegistry.unregister(info.instance);
    this._objectIdToWeakRefMap.delete(info.objectId);
    this._objectIdClientTokens.delete(info.objectId);
  }
  extractByObjectId(objectId) {
    const weakRef = this._objectIdToWeakRefMap.get(objectId);
    if (!weakRef)
      return null;
    const info = weakRef.deref() || null;
    if (info)
      this.delete(info);
    return info;
  }
  extractByInstance(object) {
    const info = this._objectToInfoMap.get(object) || null;
    if (info)
      this.delete(info);
    return info;
  }
};

// build/objectSync/syncAgentProviders.js
var SyncAgentProviders = class {
  constructor(settings) {
    __publicField(this, "commonAgentProviders");
    __publicField(this, "intrinsicsAgentProviders");
    this.commonAgentProviders = (settings.types ?? defaultSyncAgentProviders).map((o) => getSyncAgentProvider(o, false));
    this.intrinsicsAgentProviders = (settings.intrinsics ?? defaultIntrinsicSyncAgentProviders).map((o) => getSyncAgentProvider(o, true));
  }
  get all() {
    return [...this.commonAgentProviders, ...this.intrinsicsAgentProviders];
  }
  get common() {
    return this.commonAgentProviders;
  }
  get intrinsics() {
    return this.intrinsicsAgentProviders;
  }
  findOrThrow(instanceOrTypeId) {
    const syncAgent2 = this.find(instanceOrTypeId);
    if (!syncAgent2)
      throw new Error(`No sync agent provider found for value of type ${typeof instanceOrTypeId === "string" ? instanceOrTypeId : instanceOrTypeId.constructor.name}`);
    return syncAgent2;
  }
  find(instanceOrTypeId) {
    const syncAgent2 = this.commonAgentProviders.find((s) => s.canProvideAgentFor(instanceOrTypeId)) ?? this.intrinsicsAgentProviders.find((s) => s.canProvideAgentFor(instanceOrTypeId));
    return syncAgent2 ?? null;
  }
};
function getSyncAgentProvider(typeOrProvider, isIntrinsic) {
  if (isSyncAgentProvider(typeOrProvider)) {
    return typeOrProvider;
  }
  const fakeInstance = Object.setPrototypeOf({}, typeOrProvider.prototype);
  const providers = isIntrinsic ? defaultIntrinsicSyncAgentProviders : defaultSyncAgentProviders;
  const provider = providers.find((p) => p.canProvideAgentFor(fakeInstance));
  if (!provider) {
    throw new Error(`No sync agent provider found for type ${typeOrProvider.name}.`);
  }
  return provider;
}
function isSyncAgentProvider(obj) {
  return obj && typeof obj.canProvideAgentFor === "function" && typeof obj.createAgent === "function";
}

// build/objectSync/objectsView.js
var ObjectsView = class {
  constructor(_core, _predicate) {
    __publicField(this, "_core");
    __publicField(this, "_predicate");
    this._core = _core;
    this._predicate = _predicate;
  }
  get core() {
    return this._core;
  }
  findOne(constructorOrObjectId, objectId) {
    return this._core.findOne(constructorOrObjectId, objectId, this._predicate);
  }
  findAll(constructor) {
    return this._core.findAll(constructor, this._predicate);
  }
  get all() {
    return this._core.findAll(void 0, this._predicate);
  }
};
var RootObjectsView = class extends ObjectsView {
  constructor(core) {
    super(core, (info) => info.isRoot);
    __publicField(this, "_allowedRootTypes");
  }
  get allowedRootTypesFromClient() {
    return this._allowedRootTypes ?? this.core.syncAgentProviders.all.map((p) => p.syncType);
  }
  set allowedRootTypesFromClient(types) {
    this._allowedRootTypes = types;
  }
  isTypeFromClientAllowed(constructorOrTypeId) {
    const provider = this.core.syncAgentProviders.find(constructorOrTypeId);
    if (!provider) {
      return false;
    }
    if (this._allowedRootTypes === void 0) {
      return true;
    }
    return this._allowedRootTypes.includes(provider.syncType);
  }
};

// build/objectSync/objectSyncCore.js
var ObjectSyncCore = class extends EventEmitter {
  constructor(settings) {
    super();
    __publicField(this, "_objectPool", new ObjectPool());
    __publicField(this, "_weakObjectPool", null);
    __publicField(this, "_objectsWithPendingMessages", /* @__PURE__ */ new Set());
    __publicField(this, "_clients", /* @__PURE__ */ new Set());
    __publicField(this, "_settings");
    __publicField(this, "_pendingWeakDeletes", []);
    __publicField(this, "_nextObjectId", 1);
    __publicField(this, "_pendingCreateMessageByObjectId", /* @__PURE__ */ new Map());
    __publicField(this, "_ownClientToken");
    __publicField(this, "_syncAgentProviders");
    __publicField(this, "_allObjects");
    __publicField(this, "_rootObjects");
    __publicField(this, "_pendingPromise", []);
    this._syncAgentProviders = new SyncAgentProviders(settings);
    this._settings = {
      identity: settings.identity,
      objectIdGeneratorSettings: settings.objectIdGeneratorSettings ?? {
        prefix: settings.identity
      },
      arrayChangeSetMode: settings.arrayChangeSetMode ?? "compareStates",
      memoryManagementMode: settings.memoryManagementMode ?? "byClient"
    };
    if (this._settings.memoryManagementMode === "weak") {
      this._weakObjectPool = new WeakObjectPool();
      this._weakObjectPool.on("freed", (objectId, clients) => {
        this._pendingWeakDeletes.push({ objectId, clients });
      });
    }
    this._ownClientToken = this.registerClient({ identity: settings.identity });
    this._allObjects = new ObjectsView(this);
    this._rootObjects = new RootObjectsView(this);
    if (settings.allowedRootTypesFromClient) {
      this._rootObjects.allowedRootTypesFromClient = settings.allowedRootTypesFromClient;
    }
  }
  get allObjects() {
    return this._allObjects;
  }
  get rootObjects() {
    return this._rootObjects;
  }
  get settings() {
    return this._settings;
  }
  get arrayChangeSetMode() {
    return this._settings.arrayChangeSetMode;
  }
  reportPendingMessagesForObject(objectInfo) {
    if (!objectInfo.instance)
      return;
    this._objectsWithPendingMessages.add(objectInfo.instance);
  }
  generateObjectId(value) {
    if ("generateId" in this._settings.objectIdGeneratorSettings) {
      return this._settings.objectIdGeneratorSettings.generateId(value);
    } else {
      return `${this._settings.objectIdGeneratorSettings.prefix}-${this._nextObjectId++}`;
    }
  }
  registerClient(settingsOrIdentity) {
    const clientToken = new ClientToken(typeof settingsOrIdentity === "string" ? settingsOrIdentity : settingsOrIdentity.identity);
    this._clients.add(clientToken);
    return clientToken;
  }
  get registeredClientTokens() {
    return Array.from(this._clients).filter((c) => c !== this._ownClientToken);
  }
  unregisterClient(clientToken) {
    if (!this._clients.has(clientToken)) {
      throw new Error("Unknown client token");
    }
    this._objectPool.infos.forEach((info) => {
      info.syncAgent.onClientUnregistered(clientToken);
    });
    this._clients.delete(clientToken);
  }
  get identity() {
    return this._settings.identity;
  }
  get syncAgentProviders() {
    return this._syncAgentProviders;
  }
  track(instance, objectId) {
    const info = this.trackInternal(instance, objectId);
    if (!info) {
      throw new Error("Cannot track primitive value as root.");
    }
    info.isRoot = true;
    info.syncAgent.clients.add(this._ownClientToken);
    const that = this;
    return createDisposable(() => {
      if (info.isRoot) {
        info.isRoot = false;
      }
    }, {
      get objectId() {
        return info.objectId;
      },
      get instance() {
        return that._objectPool.getObjectById(objectId);
      }
    });
  }
  trackInternal(instance, objectId) {
    if (isPrimitiveValue(instance))
      return null;
    let info = this._objectPool.getInfoByObject(instance);
    if (info)
      return info;
    if (this._settings.memoryManagementMode === "weak") {
      const info2 = this._weakObjectPool.extractByInstance(instance);
      if (info2) {
        this._objectPool.add(info2);
        return info2;
      }
    }
    if (objectId !== void 0) {
      info = this._objectPool.getInfoById(objectId);
      if (info) {
        this._objectPool.onObjectSet(info);
        return info;
      }
    }
    info = new ObjectInfo(this, objectId, instance);
    info.isOwned = true;
    this._objectPool.add(info);
    info.initializeSyncAgent(instance);
    this.emit("tracked", instance, info.syncAgent);
    return info;
  }
  untrack(instance) {
    const info = this._objectPool.getInfoByObject(instance);
    if (!info || !info.isRoot || !info.isOwned)
      return false;
    info.isRoot = false;
    return true;
  }
  reportInstanceCreated(instance, objectId) {
    this.trackInternal(instance, objectId);
  }
  handleCreateMessage(message, clientToken) {
    this._pendingCreateMessageByObjectId.delete(message.objectId);
    if (message.isRoot && !this.rootObjects.isTypeFromClientAllowed(message.typeId))
      throw new Error(`Type ${message.typeId}, sent from '${clientToken.identity}' is not allowed as root type.`);
    const info = new ObjectInfo(this, message.objectId, message.typeId);
    if (message.isRoot)
      info.isRoot = true;
    this._objectPool.add(info);
    info.initializeSyncAgent(message.typeId);
    info.syncAgent.clients.add(clientToken);
    info.syncAgent.applyMessage(message, clientToken);
  }
  handleOtherMessage(message, clientToken) {
    const info = this._objectPool.getInfoById(message.objectId);
    if (!info)
      return;
    info.syncAgent.applyMessage(message, clientToken);
  }
  handleDeleteMessage(message, clientToken) {
    const info = this._objectPool.getInfoById(message.objectId);
    if (!info)
      return;
    info.syncAgent.applyMessage(message, clientToken);
    this._objectPool.deleteById(message.objectId);
  }
  serializeValue(value, clientToken) {
    if (isPrimitiveValue(value)) {
      return {
        value
      };
    }
    const objectInfo = this.trackInternal(value);
    const typeId = objectInfo.syncAgent.getTypeId(clientToken);
    if (typeId === void 0 || typeId === null) {
      return void 0;
    }
    return { objectId: objectInfo.objectId, typeId };
  }
  checkIsTypeAllowed(value, allowedTypes) {
    if (allowedTypes === void 0)
      return;
    if (value === void 0 && !allowedTypes.includes(void 0)) {
      throw new Error(`Value undefined is not allowed. Allowed types: ${allowedTypes.map((t) => t === void 0 ? "undefined" : t === null ? "null" : t.name).join(", ")}`);
    }
    if (value === void 0) {
      return;
    } else if (!("objectId" in value)) {
      let typeToTest = void 0;
      if (value.value === null) {
        typeToTest = null;
      } else if (value.value === void 0) {
        typeToTest = void 0;
      } else if (typeof value.value === "number") {
        typeToTest = Number;
      } else if (typeof value.value === "string") {
        typeToTest = String;
      } else if (typeof value.value === "boolean") {
        typeToTest = Boolean;
      }
      if (!allowedTypes.includes(typeToTest)) {
        throw new Error(`Value ${value.value} is not allowed. Allowed types: ${allowedTypes.map((t) => t === void 0 ? "undefined" : t === null ? "null" : t.name).join(", ")}`);
      }
    } else {
      let provider = null;
      const obj = this._objectPool.getObjectById(value.objectId);
      if (!obj) {
        const pendingCreateMessage = this._pendingCreateMessageByObjectId.get(value.objectId);
        if (pendingCreateMessage) {
          const typeId = pendingCreateMessage.typeId;
          provider = this.syncAgentProviders.find(typeId);
          if (!provider || !allowedTypes.includes(provider.syncType))
            throw new Error(`Not allowed typeId ${typeId}.`);
        } else {
          throw new Error(`Object with id ${value.objectId} not found`);
        }
      } else {
        const type = obj.constructor;
        provider = this.syncAgentProviders.find(type);
        if (!provider || !allowedTypes.includes(provider.syncType))
          throw new Error(`Not allowed type ${type.name}.`);
      }
    }
  }
  deserializeValue(value, clientToken, allowedTypes) {
    this.checkIsTypeAllowed(value, allowedTypes);
    if (value === void 0)
      return void 0;
    if (!("objectId" in value)) {
      return value.value;
    }
    const objectId = value.objectId;
    let instance = this._objectPool.getObjectById(objectId);
    if (instance)
      return instance;
    const createMessage = this._pendingCreateMessageByObjectId.get(objectId);
    if (!createMessage)
      throw new Error(`Object with id ${objectId} not found`);
    this.handleCreateMessage(createMessage, clientToken);
    instance = this._objectPool.getObjectById(objectId);
    if (!instance)
      throw new Error(`Object with id ${objectId} not found after processing create message`);
    return instance;
  }
  async applyMessagesAsync(messagesOrMessagesByClient, clientToken) {
    this.applyMessages(messagesOrMessagesByClient, clientToken);
    await this.awaitPendingPromises();
  }
  applyMessages(messagesOrMessagesByClient, clientToken) {
    if (messagesOrMessagesByClient instanceof Map) {
      for (const [clientToken2, messages2] of messagesOrMessagesByClient) {
        this.applyMessages(messages2, clientToken2);
      }
      return this._pendingPromise;
    }
    let messages = messagesOrMessagesByClient;
    if (this._clients.has(clientToken) === false) {
      throw new Error("Unknown client token received messages from.");
    }
    this.sortMessages(messages);
    const creationMessages = messages.filter(isCreateObjectMessage);
    messages = messages.filter((m) => !isCreateObjectMessage(m));
    for (const creationMessage of creationMessages) {
      this._pendingCreateMessageByObjectId.set(creationMessage.objectId, creationMessage);
    }
    const rootCreationMessages = creationMessages.filter((m) => m.isRoot);
    for (const creationMessage of rootCreationMessages) {
      if (this._pendingCreateMessageByObjectId.has(creationMessage.objectId))
        this.handleCreateMessage(creationMessage, clientToken);
    }
    for (const message of messages) {
      if (isDeleteObjectMessage(message))
        this.handleDeleteMessage(message, clientToken);
      else
        this.handleOtherMessage(message, clientToken);
    }
    return this._pendingPromise;
  }
  sortMessages(messages) {
    messages.sort((a, b) => {
      if (a.type === b.type)
        return 0;
      if (a.type === CreateMessageType)
        return -1;
      if (b.type === CreateMessageType)
        return 1;
      if (a.type === ChangeMessageType)
        return -1;
      if (b.type === ChangeMessageType)
        return 1;
      if (a.type === ExecuteMessageType)
        return -1;
      if (b.type === ExecuteMessageType)
        return 1;
      if (a.type === ExecuteFinishedMessageType)
        return -1;
      if (b.type === ExecuteFinishedMessageType)
        return 1;
      if (a.type === DeleteMessageType)
        return 1;
      if (b.type === DeleteMessageType)
        return -1;
      return 0;
    });
  }
  clearStates() {
    this._objectPool.infos.forEach((info) => {
      info.syncAgent.clearStates();
    });
    this._objectPool.orphanedObjectInfos(this._ownClientToken).forEach((info) => {
      if (this._objectsWithPendingMessages.has(info.instance))
        return;
      this._objectPool.deleteByObject(info.instance);
    });
    this._objectsWithPendingMessages.clear();
    this._pendingWeakDeletes.length = 0;
  }
  getMessages(clientOrClientsOrCallTick, clearNonClientStates = true) {
    let result;
    let clientTokens;
    if (typeof clientOrClientsOrCallTick === "boolean" || clientOrClientsOrCallTick === void 0) {
      clientTokens = void 0;
      clearNonClientStates = clientOrClientsOrCallTick ?? true;
    } else if (!isIterable(clientOrClientsOrCallTick)) {
      clientTokens = clientOrClientsOrCallTick;
    }
    result = this.getMessagesForClients(clientTokens ?? this._clients, clearNonClientStates);
    if (clientTokens === void 0 || isIterable(clientTokens))
      return result;
    return result.get(clientTokens);
  }
  getMessagesForClients(clientOrClientTokens, clearNonClientStates) {
    const resultByClient = /* @__PURE__ */ new Map();
    forEachIterable(clientOrClientTokens, (clientToken) => {
      if (clientToken === this._ownClientToken)
        return;
      const generatedMessages = [];
      const serializersWhichsStatesNeedsToBeCleared = /* @__PURE__ */ new Set();
      for (const instance of this._objectsWithPendingMessages) {
        const objectInfo = this.trackInternal(instance);
        if (!objectInfo.syncAgent.isForClientToken(clientToken))
          continue;
        serializersWhichsStatesNeedsToBeCleared.add(objectInfo.syncAgent);
        const isNewInstance = objectInfo.syncAgent.clients.has(clientToken) === false;
        if (isNewInstance) {
          objectInfo.syncAgent.clients.add(clientToken);
        }
        const messages = objectInfo.syncAgent.generateMessages(clientToken, isNewInstance);
        generatedMessages.push(...messages);
      }
      for (const serializer of serializersWhichsStatesNeedsToBeCleared)
        serializer.clearStates(clientToken);
      while (true) {
        let noLongerTrackedByClient = this._objectPool.objectInfosToDelete(clientToken);
        noLongerTrackedByClient = noLongerTrackedByClient.filter((o) => !this._objectsWithPendingMessages.has(o.instance));
        if (noLongerTrackedByClient.length === 0) {
          break;
        }
        for (const objectInfo of noLongerTrackedByClient) {
          if (this._settings.memoryManagementMode === "byClient") {
            objectInfo.syncAgent.onClientUnregistered(clientToken);
            generatedMessages.push({
              type: "delete",
              objectId: objectInfo.objectId
            });
          } else {
            this._weakObjectPool.add(objectInfo);
            this._objectPool.deleteById(objectInfo.objectId);
          }
        }
      }
      for (const pendingWeakDelete of this._pendingWeakDeletes) {
        if (pendingWeakDelete.clients.has(clientToken)) {
          generatedMessages.push({
            type: "delete",
            objectId: pendingWeakDelete.objectId
          });
          pendingWeakDelete.clients.delete(clientToken);
        }
      }
      resultByClient.set(clientToken, generatedMessages);
    });
    if (clearNonClientStates)
      this.clearStates();
    return resultByClient;
  }
  findOne(constructorOrObjectId, objectId, predicate) {
    if (typeof constructorOrObjectId === "string") {
      return this._objectPool.getObjectById(constructorOrObjectId);
    }
    return this._objectPool.findOne(constructorOrObjectId, objectId, predicate);
  }
  findAll(constructor, predicate) {
    return this._objectPool.findAll(constructor, predicate);
  }
  async exchangeMessagesAsync(settings) {
    const messages = settings.clients ? this.getMessages(settings.clients) : this.getMessages();
    if (settings.clientMessageFilter) {
      for (const [clientToken, clientMessages] of messages) {
        const filteredMessages = clientMessages.filter((message) => settings.clientMessageFilter(clientToken, message, false));
        messages.set(clientToken, filteredMessages);
      }
    }
    let responseMessagesByClient;
    if ("sendToClientAsync" in settings) {
      responseMessagesByClient = /* @__PURE__ */ new Map();
      for (const [clientToken, clientMessages] of messages) {
        const responseMessagesFromClient = settings.sendToClientAsync(clientToken, clientMessages);
        responseMessagesByClient.set(clientToken, responseMessagesFromClient);
      }
      await Promise.allSettled(responseMessagesByClient.values());
    } else {
      responseMessagesByClient = await settings.sendToClientsAsync(messages);
    }
    for (const [clientToken, resultsPromise] of responseMessagesByClient) {
      try {
        let messagesFromClient = await resultsPromise;
        if (settings.clientMessageFilter) {
          messagesFromClient = messagesFromClient.filter((message) => settings.clientMessageFilter(clientToken, message, true));
        }
        await this.applyMessagesAsync(messagesFromClient, clientToken);
      } catch (error) {
        settings.errorHandler?.(clientToken, error);
      }
    }
  }
  getSyncAgent(instance) {
    let info = this._objectPool.getInfoByObject(instance);
    if (!info) {
      info = this.trackInternal(instance) ?? void 0;
      if (!info) {
        throw new Error("Object is not trackable");
      }
    }
    return info.syncAgent;
  }
  getSyncAgentOrNull(instance) {
    const info = this._objectPool.getInfoByObject(instance);
    if (!info)
      return null;
    return info.syncAgent;
  }
  registerPendingPromise(promise) {
    this._pendingPromise.push(promise);
    promise.finally(() => {
      const index = this._pendingPromise.indexOf(promise);
      if (index >= 0) {
        this._pendingPromise.splice(index, 1);
      }
    });
  }
  awaitPendingPromises() {
    return Promise.all(this._pendingPromise).then(() => {
    });
  }
};

// build/objectSync/objectSync.js
var ObjectSync = class {
  constructor(settings) {
    __publicField(this, "_core");
    this._core = new ObjectSyncCore(settings);
  }
  on(event, callback) {
    this._core.on(event, callback);
  }
  once(event, callback) {
    this._core.once(event, callback);
  }
  off(event, callback) {
    this._core.off(event, callback);
  }
  listenerCount(event, callback) {
    return this._core.listenerCount(event, callback);
  }
  get allObjects() {
    return this._core.allObjects;
  }
  get rootObjects() {
    return this._core.rootObjects;
  }
  registerClient(settingsOrIdentity) {
    return this._core.registerClient(settingsOrIdentity);
  }
  unregisterClient(clientToken) {
    this._core.unregisterClient(clientToken);
  }
  get identity() {
    return this._core.identity;
  }
  track(instance, objectId) {
    return this._core.track(instance, objectId);
  }
  untrack(instance) {
    return this._core.untrack(instance);
  }
  applyMessagesAsync(messagesOrMessagesByClient, clientToken) {
    return this._core.applyMessagesAsync(messagesOrMessagesByClient, clientToken);
  }
  applyMessages(messagesOrMessagesByClient, clientToken) {
    return this._core.applyMessages(messagesOrMessagesByClient, clientToken);
  }
  clearStates() {
    this._core.clearStates();
  }
  getMessages(clientOrClientsOrCallTick, clearNonClientStates = true) {
    return this._core.getMessages(clientOrClientsOrCallTick, clearNonClientStates);
  }
  exchangeMessagesAsync(settings) {
    return this._core.exchangeMessagesAsync(settings);
  }
  getSyncAgent(instance) {
    return this._core.getSyncAgent(instance);
  }
};

// build/objectSync/standaloneSerialization.js
function serializeValue(value, settings) {
  let isPrimitive = false;
  if (typeof value !== "object") {
    value = { value };
    isPrimitive = true;
  }
  const hostSync = new ObjectSync({ ...settings, identity: settings?.identity ?? "host" });
  hostSync.track(value, isPrimitive ? "value" : "root");
  const clientToken = hostSync.registerClient({ identity: settings?.clientIdentity ?? "client" });
  const messages = hostSync.getMessages(clientToken);
  return JSON.stringify(messages);
}
function deserializeValue(data, settings) {
  const hostSync = new ObjectSync({ ...settings, identity: settings?.clientIdentity ?? "client" });
  const clientToken = hostSync.registerClient({ identity: settings?.identity ?? "host" });
  const messages = JSON.parse(data);
  const promises = hostSync.applyMessages(messages, clientToken);
  if (promises.length > 0) {
    throw new Error("Deserialization cannot be completed synchronously because there are pending promises.");
  }
  const root = hostSync.rootObjects.findOne("root");
  if (root)
    return root;
  const primitive = hostSync.rootObjects.findOne("value");
  if (primitive)
    return primitive.value;
  throw new Error("Deserialized data does not contain a root or primitive value");
}
export {
  ArraySyncAgentProvider,
  ChangeMessageType,
  ClientToken,
  CreateMessageType,
  DeleteMessageType,
  EventEmitter,
  ExecuteFinishedMessageType,
  ExecuteMessageType,
  ExtendedSyncAgent,
  MapSyncAgentProvider,
  ObjectSync,
  SetSyncAgentProvider,
  SyncAgent,
  SyncableArray,
  SyncableArraySyncAgentProvider,
  SyncableMap,
  SyncableMapSyncAgentProvider,
  SyncableObservableArray,
  SyncableObservableArraySyncAgentProvider,
  SyncableObservableMap,
  SyncableObservableMapSyncAgentProvider,
  SyncableObservableSet,
  SyncableObservableSetSyncAgentProvider,
  SyncableSet,
  SyncableSetSyncAgentProvider,
  createSimpleSyncAgentProvider,
  defaultIntrinsicSyncAgentProviders,
  defaultSyncAgentProviders,
  deserializeValue,
  isChangeObjectMessage,
  isCreateObjectMessage,
  isDeleteObjectMessage,
  isExecuteFinishedObjectMessage,
  isExecuteObjectMessage,
  nothing,
  serializeValue,
  syncAgent,
  syncMethod,
  syncObject,
  syncProperty
};
//# sourceMappingURL=index.js.map
