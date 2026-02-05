var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// build/shared/decorators.js
Symbol.metadata ?? (Symbol.metadata = Symbol("metadata"));

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

// build/decorators/base.js
var nothing = Symbol("nothing");
var ObjectSyncMetaInfo = class extends EventEmitter {
  reportPropertyChanged(instance, propertyInfo, propertyKey, value) {
    this.emit("propertyChanged", propertyInfo, instance, propertyKey, value);
  }
};
var metaInfoByValue = /* @__PURE__ */ new WeakMap();
function ensureObjectSyncMetaInfo(instance) {
  let metaInfo = metaInfoByValue.get(instance);
  if (!metaInfo) {
    metaInfo = new ObjectSyncMetaInfo();
    metaInfoByValue.set(instance, metaInfo);
  }
  return metaInfo;
}
function getObjectSyncMetaInfo(instance) {
  return metaInfoByValue.get(instance) || null;
}

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
function isPrimitiveValue(value) {
  return value === void 0 || value === null || typeof value !== "object" && typeof value !== "function";
}
function isPromiseLike(value) {
  return value && typeof value.then === "function" && typeof value.catch === "function";
}

// build/serialization/serializedTypes.js
var getSerializerSymbol = Symbol("getSerializer");

// build/serialization/serializers/base.js
var defaultIntrinsicSerializers = [];
var defaultSerializersOrTypes = [];
function createSerializerClass(baseClass, constructor, typeId, isInstrinsic) {
  const result = class TypedMapSerializer extends baseClass {
    static canSerialize(instanceOrTypeId) {
      if (typeof instanceOrTypeId === "string") {
        return instanceOrTypeId === typeId;
      }
      return instanceOrTypeId instanceof constructor;
    }
    constructor(objectInfo) {
      super(constructor, typeId, objectInfo);
    }
  };
  if (isInstrinsic) {
    defaultIntrinsicSerializers.push(result);
  } else {
    defaultSerializersOrTypes.push(result);
    Object.defineProperty(constructor, getSerializerSymbol, {
      value: () => result,
      writable: false,
      configurable: false,
      enumerable: false
    });
  }
  return result;
}

// build/serialization/serializer.js
var TypeSerializer = class {
  constructor(_objectInfo) {
    __publicField(this, "_objectInfo");
    __publicField(this, "_clients", /* @__PURE__ */ new Set());
    __publicField(this, "_storedReferencesByKey", /* @__PURE__ */ new Map());
    __publicField(this, "_hasPendingChanges", false);
    this._objectInfo = _objectInfo;
  }
  static canSerialize(instanceOrTypeId) {
    throw new Error("Not implemented");
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
  onClientRemoved(clientToken) {
    this._clients.delete(clientToken);
    this._storedReferencesByKey.forEach((storedReferencesByClient, key) => {
      const storedReference = storedReferencesByClient.get(clientToken);
      storedReference?.dispose();
    });
  }
  clearStates(clientToken) {
    if (!clientToken)
      this._hasPendingChanges = false;
  }
  reportPendingMessages() {
    this._objectInfo.owner.reportPendingMessagesForObject(this._objectInfo);
  }
  serializeValue(value, clientToken) {
    return this._objectInfo.owner.serializeValue(value, clientToken);
  }
  deserializeValue(value, clientToken) {
    return this._objectInfo.owner.deserializeValue(value, clientToken);
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
      return {
        dispose() {
        }
      };
    }
    let isDisposed = false;
    const finalStoredReference = {
      dispose: () => {
        if (isDisposed)
          return;
        isDisposed = true;
        for (const disposable of disposables) {
          disposable.dispose();
        }
        storedReferencesByClient.delete(settings.clientToken);
        if (storedReferencesByClient.size === 0) {
          this._storedReferencesByKey.delete(settings.key);
        }
      }
    };
    storedReferencesByClient.set(settings.clientToken, finalStoredReference);
    return finalStoredReference;
  }
  clearStoredReferencesWithKey(key) {
    const storedReferencesByClient = this._storedReferencesByKey.get(key);
    if (storedReferencesByClient) {
      storedReferencesByClient.forEach((storedReference) => {
        storedReference.dispose();
      });
    }
  }
  clearStoredReferencesWithClientToken(clientToken) {
    this._storedReferencesByKey.forEach((storedReferencesByClient) => {
      const storedReference = storedReferencesByClient.get(clientToken);
      storedReference?.dispose();
    });
  }
  get dispatcher() {
    return null;
  }
};
var ExtendedTypeSerializer = class extends TypeSerializer {
  constructor(objectInfo) {
    super(objectInfo);
    __publicField(this, "_messageTypeToHandler", /* @__PURE__ */ new Map());
    this.registerMessageHandler("create", (message, clientToken) => this.onCreateMessageReceived(message, clientToken));
    this.registerMessageHandler("change", (message, clientToken) => this.onChangeMessageReceived(message, clientToken));
  }
  registerMessageHandler(messageType, handler) {
    this._messageTypeToHandler.set(messageType, handler);
  }
  async applyMessage(message, clientToken) {
    const handler = this._messageTypeToHandler.get(message.type);
    if (handler) {
      await handler(message, clientToken);
    } else if (message.type === "create") {
      throw new Error(`No handler registered for message type '${message.type}' in serializer.`);
    }
  }
  onChangeMessageReceived(message, clientToken) {
  }
};
function createSimpleTypeSerializerClass(settings) {
  const { type, typeId, serialize, deserialize } = settings;
  const result = class SimpleTypeSerializer extends ExtendedTypeSerializer {
    static canSerialize(instanceOrTypeId) {
      if (typeof instanceOrTypeId === "string") {
        return instanceOrTypeId === typeId;
      } else {
        return instanceOrTypeId instanceof type;
      }
    }
    getTypeId(clientToken) {
      return typeId;
    }
    generateMessages(clientToken, isNewClient) {
      const messages = [];
      if (isNewClient) {
        messages.push({
          type: "create",
          objectId: this.objectId,
          typeId,
          data: serialize(this.instance)
        });
      }
      return messages;
    }
    onCreateMessageReceived(message, clientToken) {
      this.instance = deserialize(message.data);
    }
  };
  defaultSerializersOrTypes.push(result);
  Object.defineProperty(type, getSerializerSymbol, {
    value: () => result,
    writable: true,
    configurable: false,
    enumerable: false
  });
  return result;
}

// build/decorators/syncMethod.js
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

// build/serialization/serializers/syncObject/serializer.js
var SyncObjectSerializer = class extends ExtendedTypeSerializer {
  constructor(objectInfo) {
    super(objectInfo);
    __publicField(this, "_typeInfo", null);
    __publicField(this, "_properties", /* @__PURE__ */ new Map());
    __publicField(this, "_temporaryReferencesByClient", /* @__PURE__ */ new Map());
    __publicField(this, "_pendingInvokeMethodInfosById", /* @__PURE__ */ new Map());
    __publicField(this, "_methodInvokeResultsByClient", /* @__PURE__ */ new Map());
    __publicField(this, "_nextInvokeId", 1);
    __publicField(this, "_dispatcher");
    this.registerMessageHandler("execute", (message, clientToken) => this.onExecuteMessageReceived(message, clientToken));
    this.registerMessageHandler("executeFinished", (message, clientToken) => this.onExecuteFinishedMessageReceived(message, clientToken));
  }
  createTemporaryReference(value, clientToken) {
    if (isPrimitiveValue(value)) {
      return {
        dispose() {
        }
      };
    }
    const storedReference = this._objectInfo.owner.trackInternal(value).addReference(clientToken);
    let tempRefs = this._temporaryReferencesByClient.get(clientToken);
    if (!tempRefs) {
      tempRefs = [];
      this._temporaryReferencesByClient.set(clientToken, tempRefs);
    }
    tempRefs.push(storedReference);
    return storedReference;
  }
  onInstanceSet(createdByCreateObjectMessage) {
    super.onInstanceSet(createdByCreateObjectMessage);
    const metaInfo = ensureObjectSyncMetaInfo(this.instance);
    metaInfo?.on("propertyChanged", (propertyInfo, instance, propertyKey, value) => {
      this.reportPropertyChanged(propertyInfo, propertyKey, value);
    });
    if (createdByCreateObjectMessage)
      return;
    this._typeInfo = getTrackableTypeInfo(this.instance.constructor);
    this._typeInfo.trackedProperties.forEach((propertyInfo, key) => {
      this.reportPropertyChanged(propertyInfo, key, this.instance[key]);
    });
  }
  async onCreateMessageReceived(message, clientToken) {
    const constructorArguments = (message.data["[[constructor]]"] ?? []).map((arg) => {
      return this.deserializeValue(arg, clientToken);
    });
    this.instance = new this.type(...constructorArguments);
    await this.onChangeMessageReceived(message, clientToken);
    this._properties.forEach((propertyValueInfo, propertyKey) => {
      propertyValueInfo.hasPendingChanges = false;
    });
  }
  onChangeMessageReceived(message, clientToken) {
    for (const key of Object.keys(message.data)) {
      if (!checkCanApplyProperty(this.instance.constructor, this.instance, key, false, clientToken))
        continue;
      const value = this.deserializeValue(message.data[key], clientToken);
      const property = this._properties.get(key);
      try {
        if (property)
          property.isBeeingApplied = true;
        this.instance[key] = value;
      } finally {
        if (property)
          property.isBeeingApplied = false;
      }
    }
  }
  async onExecuteMessageReceived(message, clientToken) {
    if (typeof this.instance[message.method] !== "function") {
      throw new Error(`Target with id ${message.objectId} has no method ${message.method}`);
    }
    const finishInvoke = (result, error) => {
      let methodInvokeResults = this._methodInvokeResultsByClient.get(clientToken);
      if (!methodInvokeResults) {
        methodInvokeResults = [];
        this._methodInvokeResultsByClient.set(clientToken, methodInvokeResults);
      }
      if (error)
        methodInvokeResults.push({ objectId: message.objectId, invokeId: message.id, error });
      else
        methodInvokeResults.push({ objectId: message.objectId, invokeId: message.id, result });
      this.reportPendingMessages();
    };
    if (!checkCanApplyProperty(this.instance.constructor, this.instance, message.method, true, clientToken)) {
      finishInvoke(null, "Not allowed.");
      return;
    }
    const parameters = message.parameters.map((value) => {
      return this.deserializeValue(value, clientToken);
    });
    let resultOrPromise;
    try {
      resultOrPromise = this.instance[message.method](...parameters);
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
      if (promiseHandlingType === "await")
        await promise;
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
      const finalConstructorArguments = data["[[constructor]]"] = [];
      if (Array.isArray(constructorArgumentsResult)) {
        constructorArgumentsResult.forEach((propertyKey) => {
          propertiesToOmit.add(propertyKey);
          const propertyValueInfo = this._properties.get(propertyKey);
          if (!propertyValueInfo) {
            throw new Error(`Cannot use property '${propertyKey}' as constructor argument for type '${this.typeId}' because it is not a tracked property.`);
          }
          const value = propertyValueInfo.value;
          const beforeSendResult = beforeSendPropertyToClient(this.instance.constructor, this.instance, propertyKey, value, clientToken);
          if (beforeSendResult.skip)
            return;
          this.storeReference({ value: beforeSendResult.value, key: propertyKey, clientToken });
          finalConstructorArguments.push(this.serializeValue(beforeSendResult.value, clientToken));
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
      this.storeReference({ value: beforeSendResult.value, key: propertyKey, clientToken });
      data[propertyKey] = this.serializeValue(beforeSendResult.value, clientToken);
    });
    const createMessage = {
      type: "create",
      objectId: this.objectId,
      typeId,
      data
    };
    return createMessage;
  }
  generateChangeMessage(clientToken) {
    const data = {};
    let hasDataToSend = false;
    this._properties.forEach((propertyValueInfo, propertyKey) => {
      if (!propertyValueInfo.hasPendingChanges)
        return;
      const value = propertyValueInfo.value;
      const beforeSendResult = beforeSendPropertyToClient(this.instance.constructor, this.instance, propertyKey, value, clientToken);
      if (beforeSendResult.skip)
        return;
      this.storeReference({ value: beforeSendResult.value, key: propertyKey, clientToken });
      const transformedValue = this.serializeValue(beforeSendResult.value, clientToken);
      data[propertyKey] = transformedValue;
      hasDataToSend = true;
    });
    if (!hasDataToSend)
      return null;
    const changeMessage = {
      type: "change",
      objectId: this.objectId,
      data
    };
    return changeMessage;
  }
  generateMessages(clientToken, isNewClient) {
    const result = [];
    if (isNewClient || this.hasPendingChanges) {
      let typeId = this.getTypeId(clientToken);
      if (typeId === null) {
        return result;
      }
      if (isNewClient)
        result.push(this.generateCreateMessage(typeId, clientToken));
      else {
        const changeMessage = this.generateChangeMessage(clientToken);
        if (changeMessage)
          result.push(changeMessage);
      }
    }
    this.generateExecuteMessages(clientToken, result);
    this.generateExecuteResultMessages(clientToken, result);
    return result;
  }
  generateExecuteResultMessages(clientToken, result) {
    const methodInvokeResults = this._methodInvokeResultsByClient.get(clientToken);
    if (methodInvokeResults) {
      this._methodInvokeResultsByClient.delete(clientToken);
      for (const methodInvokeResult of methodInvokeResults ?? []) {
        const executeFinishedMessage = {
          type: "executeFinished",
          objectId: methodInvokeResult.objectId,
          invokeId: methodInvokeResult.invokeId
        };
        if ("result" in methodInvokeResult) {
          this.createTemporaryReference(methodInvokeResult.result, clientToken);
          executeFinishedMessage.result = this.serializeValue(methodInvokeResult.result, clientToken);
        }
        if ("error" in methodInvokeResult) {
          this.createTemporaryReference(methodInvokeResult.error, clientToken);
          executeFinishedMessage.error = this.serializeValue(methodInvokeResult.error, clientToken);
        }
        result.push(executeFinishedMessage);
      }
    }
  }
  generateExecuteMessages(clientToken, result) {
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
        this.createTemporaryReference(arg, clientToken);
        const transformedValue = this.serializeValue(arg, clientToken);
        return transformedValue;
      });
      const executeMessage = {
        id: pendingInvokeMethodInfos.id,
        type: "execute",
        objectId: this.objectId,
        method: pendingInvokeMethodInfos.methodName,
        parameters
      };
      result.push(executeMessage);
    }
  }
  getTypeId(clientToken) {
    const typeIdOrNothing = beforeSendObjectToClient(this.type, this.instance, this.typeId, clientToken);
    if (typeIdOrNothing === nothing)
      return null;
    return typeIdOrNothing;
  }
  reportPropertyChanged(propertyInfo, key, value) {
    if (!this.checkCanTrackPropertyInfo(propertyInfo, this.instance, key))
      return;
    let current = this._properties.get(key);
    if (!current) {
      current = {
        hasPendingChanges: true,
        value: void 0,
        propertyInfo,
        isBeeingApplied: false
      };
      this._properties.set(key, current);
      this.hasPendingChanges = true;
    }
    if (current.value === value)
      return;
    this.clearStoredReferencesWithKey(key);
    current.value = value;
    if (current.isBeeingApplied)
      return;
    current.hasPendingChanges = true;
    this.hasPendingChanges = true;
  }
  clearStates(clientToken) {
    super.clearStates(clientToken);
    if (clientToken) {
      this._methodInvokeResultsByClient.delete(clientToken);
      const tempRefs = this._temporaryReferencesByClient.get(clientToken);
      if (tempRefs) {
        for (const storedReference of tempRefs) {
          storedReference.dispose();
        }
        this._temporaryReferencesByClient.delete(clientToken);
      }
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
  get dispatcher() {
    return this._dispatcher ?? (this._dispatcher = this.createDispatcher());
  }
  createDispatcher() {
    const result = {
      invoke: (clientOrClientsOrMethodName, ...args) => {
        if (typeof clientOrClientsOrMethodName === "string") {
          const methodName = clientOrClientsOrMethodName;
          return this.invokeMethodForClients(void 0, methodName, ...args);
        } else {
          const clientOrClients = clientOrClientsOrMethodName;
          const methodName = args.shift();
          const result2 = this.invokeMethodForClients(clientOrClients, methodName, ...args);
          if (isIterable(clientOrClients)) {
            return result2;
          } else {
            const client = clientOrClients;
            return result2.get(client);
          }
        }
      }
    };
    return result;
  }
  invokeMethodForClients(clientOrClients, methodName, ...parameters) {
    const clients = clientOrClients ?? this._objectInfo.owner.registeredClientTokens;
    const methodInfo = this._typeInfo.trackedMethods.get(methodName);
    const resultByClient = /* @__PURE__ */ new Map();
    if (!this.checkCanTrackPropertyInfo(methodInfo, this.instance, methodName)) {
      forEachIterable(clients, (c) => {
        resultByClient.set(c, Promise.reject(new Error(`Not allowed to invoke method ${methodName} on object ${this.objectId}.`)));
      });
      return resultByClient;
    }
    const id = this._nextInvokeId++;
    const promiseDataByClient = /* @__PURE__ */ new Map();
    const invokeMethodInfo = {
      id,
      methodName,
      parameters,
      invokeMethodInfoByClient: promiseDataByClient
    };
    forEachIterable(clients, (clientToken) => {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => {
        resolve = (data) => {
          res(this.deserializeValue(data, clientToken));
        };
        reject = (data) => {
          rej(this.deserializeValue(data, clientToken));
        };
      });
      promise.finally(() => {
        invokeMethodInfo.invokeMethodInfoByClient.delete(clientToken);
        if (invokeMethodInfo.invokeMethodInfoByClient.size === 0) {
          this._pendingInvokeMethodInfosById.delete(id);
        }
      });
      resultByClient.set(clientToken, promise);
      promiseDataByClient.set(clientToken, {
        resolve,
        reject,
        sentToClient: false
      });
    });
    this._pendingInvokeMethodInfosById.set(invokeMethodInfo.id, invokeMethodInfo);
    this.reportPendingMessages();
    return resultByClient;
  }
};

// build/serialization/serializers/syncObject/typedSerializer.js
var serializersByType = /* @__PURE__ */ new Map();
function getSyncObjectSerializer(type) {
  if (serializersByType.has(type)) {
    return serializersByType.get(type);
  }
  const typeId = getTrackableTypeInfo(type).typeId;
  const TypedSyncObjectSerializer = class TypedSyncObjectSerializer extends SyncObjectSerializer {
    static canSerialize(instanceOrTypeId) {
      if (typeof instanceOrTypeId === "string") {
        return instanceOrTypeId === typeId;
      }
      return instanceOrTypeId.constructor === type;
    }
    get type() {
      return type;
    }
    get typeId() {
      return typeId;
    }
    constructor(objectInfo) {
      super(objectInfo);
    }
  };
  serializersByType.set(type, TypedSyncObjectSerializer);
  return TypedSyncObjectSerializer;
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

// build/serialization/serializers/array/metaInfo.js
var SyncArrayMetaInfo = class extends MetaInfo {
  reportSplice(instance, change) {
    this.emit("spliced", instance, change);
  }
};

// build/serialization/serializers/array/syncableArray.js
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
    const deletedItems = super.splice(actualStart, actualDeleteCount, ...items);
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

// build/serialization/serializers/array/syncableObservableArray.js
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

// build/serialization/serializers/array/changeSet.js
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

// build/serialization/serializers/array/serializer.js
var TYPE_ID_NATIVEARRAY = "<nativeArray>";
var TYPE_ID_SYNCARRAY = "<syncArray>";
var TYPE_ID_OBSERVABLEARRAY = "<syncObservableArray>";
var SyncableArraySerializerBase = class extends ExtendedTypeSerializer {
  constructor(_arrayType, _typeId, objectInfo) {
    super(objectInfo);
    __publicField(this, "_arrayType");
    __publicField(this, "_typeId");
    __publicField(this, "_oldArrayContent", []);
    __publicField(this, "_temporaryChanges", null);
    __publicField(this, "_dispatcher");
    __publicField(this, "_changeSetMode");
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
  reportSplice(start, deleteCount, ...items) {
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
  onCreateMessageReceived(message, clientToken) {
    this.instance = new this._arrayType();
    this.instance.push(...message.data.map((value) => this.deserializeValue(value, clientToken)));
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
      this.clearStoredReferencesWithClientToken(clientToken);
      const data = this.instance.map((element, index) => {
        this.storeReference({ value: element, key: index, clientToken });
        return this.serializeValue(element, clientToken);
      });
      const createMessage = {
        type: "create",
        objectId: this.objectId,
        typeId: this.getTypeId(clientToken),
        data
      };
      messages.push(createMessage);
    } else if (this.hasPendingChanges) {
      this._temporaryChanges?.forEach((change) => {
        for (let i = 0; i < change.deleteCount; i++) {
          this.storeReference({ value: void 0, key: change.start + i, clientToken });
        }
        change.items.forEach((item, itemIndex) => {
          this.storeReference({ value: item, key: change.start + itemIndex, clientToken });
        });
      });
      const data = this._temporaryChanges.map((change) => ({
        start: change.start,
        deleteCount: change.deleteCount,
        items: change.items.map((item) => {
          const mappedValue = this.serializeValue(item, clientToken);
          return mappedValue;
        })
      }));
      const changeMessage = {
        type: "change",
        objectId: this.objectId,
        data
      };
      messages.push(changeMessage);
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
  get dispatcher() {
    return this._dispatcher ?? (this._dispatcher = this.createDispatcher());
  }
  createDispatcher() {
    const self = this;
    const result = {
      reportSplice(...args) {
        if (args.length === 0 && self.changeSetMode !== "compareStates") {
          throw new Error("reportSplice requires parameters when arrayChangeSetMode is not 'compareStates'.");
        } else if (args.length !== 0 && self.changeSetMode !== "trackSplices") {
          throw new Error("reportSplice with parameters requires arrayChangeSetMode to be 'trackSplices'.");
        }
        self.reportSplice(...args);
      },
      get changeSetMode() {
        return self.changeSetMode;
      },
      set changeSetMode(value) {
        self.changeSetMode = value;
      }
    };
    return result;
  }
};
var ArraySerializer = createSerializerClass(SyncableArraySerializerBase, Array, TYPE_ID_NATIVEARRAY, true);
var SyncableArraySerializer = createSerializerClass(SyncableArraySerializerBase, SyncableArray, TYPE_ID_SYNCARRAY, false);
var SyncableObservableArraySerializer = createSerializerClass(SyncableArraySerializerBase, SyncableObservableArray, TYPE_ID_OBSERVABLEARRAY, false);

// build/serialization/serializers/map/metaInfo.js
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

// build/serialization/serializers/map/syncableMap.js
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

// build/serialization/serializers/map/serializer.js
var TYPE_ID_NATIVEMAP = "<nativeMap>";
var TYPE_ID_SYNCABLEMAP = "<syncableMap>";
var SyncableMapSerializerBase = class extends ExtendedTypeSerializer {
  constructor(_mapType, _typeId, objectInfo) {
    super(objectInfo);
    __publicField(this, "_mapType");
    __publicField(this, "_typeId");
    __publicField(this, "_changes", []);
    __publicField(this, "_dispatcher");
    this._mapType = _mapType;
    this._typeId = _typeId;
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
    this._changes.length = 0;
    this._changes.push({ clear: true });
    this.hasPendingChanges = true;
  }
  reportChange(key, value) {
    this._changes.push({ key, value });
    this.hasPendingChanges = true;
  }
  reportDelete(key) {
    this._changes = this._changes.filter((change) => "key" in change && change.key !== key);
    this._changes.push({ key, delete: true });
    this.hasPendingChanges = true;
  }
  onCreateMessageReceived(message, clientToken) {
    this.instance = new this._mapType();
    for (const { key, value } of message.data) {
      const deserializedKey = this.deserializeValue(key, clientToken);
      const deserializedValue = this.deserializeValue(value, clientToken);
      this.instance.set(deserializedKey, deserializedValue);
    }
  }
  onChangeMessageReceived(message, clientToken) {
    for (const change of message.data) {
      if ("clear" in change) {
        this.instance.clear();
        continue;
      } else if ("delete" in change) {
        const deserializedKey = this.deserializeValue(change.key, clientToken);
        this.instance.delete(deserializedKey);
        continue;
      } else {
        const deserializedKey = this.deserializeValue(change.key, clientToken);
        const deserializedValue = this.deserializeValue(change.value, clientToken);
        this.instance.set(deserializedKey, deserializedValue);
      }
    }
  }
  generateMessages(clientToken, isNewClient) {
    if (!isNewClient && !this.hasPendingChanges)
      return [];
    if (isNewClient) {
      const message = {
        type: "create",
        objectId: this.objectId,
        typeId: this.getTypeId(clientToken),
        data: this.getCreationData(clientToken)
      };
      return [message];
    } else {
      const message = {
        type: "change",
        objectId: this.objectId,
        data: this.getChangeData(clientToken)
      };
      return [message];
    }
    return [];
  }
  getChangeData(clientToken) {
    return this._changes.map((change) => {
      if ("clear" in change) {
        this.clearStoredReferencesWithClientToken(clientToken);
        return { clear: true };
      } else if ("delete" in change) {
        this.storeReference({
          value: void 0,
          key: change.key,
          clientToken
        });
        const serializedKey = this.serializeValue(change.key, clientToken);
        return { key: serializedKey, delete: true };
      } else {
        this.storeReference({
          clientToken,
          key: change.key,
          values: [change.key, change.value]
        });
        const serializedKey = this.serializeValue(change.key, clientToken);
        const serializedValue = this.serializeValue(change.value, clientToken);
        return { key: serializedKey, value: serializedValue };
      }
    });
  }
  getCreationData(clientToken) {
    this.clearStoredReferencesWithClientToken(clientToken);
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
  get dispatcher() {
    return this._dispatcher ?? (this._dispatcher = this.createDispatcher());
  }
  createDispatcher() {
    const self = this;
    const result = {
      reportClear() {
        self.reportClear();
      },
      reportChange(key, value) {
        self.reportChange(key, value);
      },
      reportDelete(key) {
        self.reportDelete(key);
      }
    };
    return result;
  }
};
var MapSerializer = createSerializerClass(SyncableMapSerializerBase, Map, TYPE_ID_NATIVEMAP, true);
var SyncableMapSerializer = createSerializerClass(SyncableMapSerializerBase, SyncableMap, TYPE_ID_SYNCABLEMAP, false);

// build/serialization/serializers/set/metaInfo.js
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

// build/serialization/serializers/set/serializer.js
var TYPE_ID_NATIVESET = "<nativeSet>";
var TYPE_ID_SYNCABLESET = "<syncableSet>";
var SyncableSetSerializerBase = class extends ExtendedTypeSerializer {
  constructor(_setType, _typeId, objectInfo) {
    super(objectInfo);
    __publicField(this, "_setType");
    __publicField(this, "_typeId");
    __publicField(this, "_changes", []);
    __publicField(this, "_dispatcher");
    this._setType = _setType;
    this._typeId = _typeId;
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
    this._changes.length = 0;
    this._changes.push({ clear: true });
    this.hasPendingChanges = true;
  }
  reportAdd(value) {
    this._changes = this._changes.filter((change) => "value" in change && change.value !== value);
    this._changes.push({ value });
    this.hasPendingChanges = true;
  }
  reportDelete(value) {
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
        const deserializedValue = this.deserializeValue(change.value, clientToken);
        this.instance.delete(deserializedValue);
        continue;
      } else {
        const deserializedValue = this.deserializeValue(change.value, clientToken);
        this.instance.add(deserializedValue);
      }
    }
  }
  generateMessages(clientToken, isNewClient) {
    if (!isNewClient && !this.hasPendingChanges)
      return [];
    if (isNewClient) {
      const message = {
        type: "create",
        objectId: this.objectId,
        typeId: this.getTypeId(clientToken),
        data: this.getCreationData(clientToken)
      };
      return [message];
    } else {
      const message = {
        type: "change",
        objectId: this.objectId,
        data: this.getChangeData(clientToken)
      };
      return [message];
    }
    return [];
  }
  getChangeData(clientToken) {
    return this._changes.map((change) => {
      if ("clear" in change) {
        this.clearStoredReferencesWithClientToken(clientToken);
        return { clear: true };
      } else if ("delete" in change) {
        this.storeReference({
          value: void 0,
          key: change.value,
          clientToken
        });
        const serializedValue = this.serializeValue(change.value, clientToken);
        return { value: serializedValue, delete: true };
      } else {
        this.storeReference({
          clientToken,
          key: change.value,
          value: change.value
        });
        const serializedValue = this.serializeValue(change.value, clientToken);
        return { value: serializedValue };
      }
    });
  }
  getCreationData(clientToken) {
    this.clearStoredReferencesWithClientToken(clientToken);
    const data = [];
    for (const value of this.instance) {
      this.storeReference({
        clientToken,
        key: value,
        value
      });
      const serializedValue = this.serializeValue(value, clientToken);
      data.push(serializedValue);
    }
    return data;
  }
  clearStates(clientToken) {
    super.clearStates(clientToken);
    if (!clientToken)
      this._changes.length = 0;
  }
  get dispatcher() {
    return this._dispatcher ?? (this._dispatcher = this.createDispatcher());
  }
  createDispatcher() {
    const self = this;
    const result = {
      reportClear() {
        self.reportClear();
      },
      reportAdd(value) {
        self.reportAdd(value);
      },
      reportDelete(value) {
        self.reportDelete(value);
      }
    };
    return result;
  }
};
var SetSerializer = createSerializerClass(SyncableSetSerializerBase, Set, TYPE_ID_NATIVESET, true);
var SyncableSetSerializer = createSerializerClass(SyncableSetSerializerBase, Set, TYPE_ID_SYNCABLESET, false);

// build/serialization/serializers/object.js
var TYPE_ID = "<object>";
var ObjectSerializer = class extends ExtendedTypeSerializer {
  static canSerialize(instanceOrTypeId) {
    if (typeof instanceOrTypeId === "string") {
      return instanceOrTypeId === TYPE_ID;
    }
    return typeof instanceOrTypeId === "object";
  }
  constructor(objectInfo) {
    super(objectInfo);
  }
  onInstanceSet(createdByCreateObjectMessage) {
    super.onInstanceSet(createdByCreateObjectMessage);
  }
  getTypeId(clientToken) {
    return TYPE_ID;
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
    if (!isNewClient && !this.hasPendingChanges)
      return [];
    const message = {
      type: isNewClient ? "create" : "change",
      objectId: this.objectId,
      typeId: isNewClient ? TYPE_ID : void 0,
      data: this.getSerializedData(clientToken)
    };
    return [message];
  }
  getSerializedData(clientToken) {
    this.clearStoredReferencesWithClientToken(clientToken);
    const data = {};
    for (const key of Object.keys(this.instance)) {
      const value = this.instance[key];
      this.storeReference({ value, key, clientToken });
      const mappedValue = this.serializeValue(value, clientToken);
      data[key] = mappedValue;
    }
    return data;
  }
};
defaultIntrinsicSerializers.push(ObjectSerializer);

// build/decorators/syncObject.js
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
    allSyncObjectTypes.add(target);
    defaultSerializersOrTypes.push(target);
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

// build/decorators/syncProperty.js
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
        const metaInfo = getObjectSyncMetaInfo(this);
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

// build/shared/messages.js
var isPropertyInfoSymbol = Symbol("isPropertyInfo");
var CreateMessageType = "create";
var ChangeMessageType = "change";
var DeleteMessageType = "delete";
var ExecuteMessageType = "execute";
var ExecuteFinishedMessageType = "executeFinished";
function isExecuteObjectMessage(message) {
  return message.type === ExecuteMessageType;
}
function isChangeObjectMessage(message) {
  return message.type === ChangeMessageType;
}
function isCreateObjectMessage(message) {
  return message.type === CreateMessageType;
}
function isDeleteObjectMessage(message) {
  return message.type === DeleteMessageType;
}
function isExecuteFinishedObjectMessage(message) {
  return message.type === ExecuteFinishedMessageType;
}

// build/objectSync/clientFilter.js
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

// build/shared/objectInfo.js
var ObjectInfo = class {
  constructor(_owner, _objectId = null, instanceOrTypeId = null, _isRoot = false) {
    __publicField(this, "_owner");
    __publicField(this, "_objectId");
    __publicField(this, "_isRoot");
    __publicField(this, "_serializer", null);
    __publicField(this, "_instance", null);
    __publicField(this, "_clientFilters", null);
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
  initializeSerializer(instanceOrTypeId = null) {
    const Serializer = this._owner.findSerializer(instanceOrTypeId);
    this._serializer = new Serializer(this);
    if (this._instance)
      this._serializer.onInstanceSet(false);
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
  get serializer() {
    return this._serializer;
  }
  get owner() {
    return this._owner;
  }
  addReference(clientToken) {
    this._referenceCountByClient.set(clientToken, (this._referenceCountByClient.get(clientToken) ?? 0) + 1);
    let isDisposed = false;
    return {
      dispose: () => {
        if (isDisposed)
          return;
        isDisposed = true;
        this.removeReference(clientToken);
      }
    };
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
    return this._instance !== null && this._isOwned && !this._isRoot && this._serializer.clients.has(clientToken) && (this._referenceCountByClient.get(clientToken) ?? 0) <= 0;
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
  setClientRestriction(filter) {
    this._clientFilters = {
      clientTokens: filter.clientTokens ? toIterable(filter.clientTokens, true) : void 0,
      identities: filter.identities ? toIterable(filter.identities, true) : void 0,
      isExclusive: filter.isExclusive ?? true
    };
  }
  isForClientToken(clientToken) {
    if (!this._clientFilters)
      return true;
    const filter = this._clientFilters;
    return isForClientToken(clientToken, filter);
  }
  removeClientRestrictions() {
    this._clientFilters = null;
  }
};

// build/shared/objectPool.js
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
  findOne(constructor, objectId) {
    return this.infos.find((info) => {
      return info.instance && info.instance instanceof constructor && (objectId === void 0 || info.objectId === objectId);
    })?.instance;
  }
  findAll(constructor) {
    return this.infos.filter((info) => {
      return info.instance && info.instance instanceof constructor;
    }).map((info) => info.instance);
  }
};

// build/shared/weakObjectPool.js
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
    this._objectIdClientTokens.set(info.objectId, info.serializer.clients);
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

// build/serialization/utils.js
function getTypeSerializerClass(possibleSerializer) {
  if ("canSerialize" in possibleSerializer) {
    return possibleSerializer;
  }
  if (getSerializerSymbol in possibleSerializer) {
    return possibleSerializer[getSerializerSymbol]();
  }
  const typeInfo = getTrackableTypeInfo(possibleSerializer);
  if (!typeInfo) {
    throw new Error(`Type '${possibleSerializer.name}' is not registered as a trackable type and not a TypeSerializer. Either decorate it with @syncObject, ensure that the type is a TypeSerializer or add the getSerializer symbol which returns the TypeSerializer for the provided type.`);
  }
  return getSyncObjectSerializer(possibleSerializer);
}

// build/objectSync/objectSync.js
var ObjectSync = class {
  constructor(settings) {
    __publicField(this, "_objectPool", new ObjectPool());
    __publicField(this, "_weakObjectPool", null);
    __publicField(this, "_objectsWithPendingMessages", /* @__PURE__ */ new Set());
    __publicField(this, "_clients", /* @__PURE__ */ new Set());
    __publicField(this, "_settings");
    __publicField(this, "_pendingWeakDeletes", []);
    __publicField(this, "_nextObjectId", 1);
    __publicField(this, "_pendingCreateMessageByObjectId", /* @__PURE__ */ new Map());
    __publicField(this, "_ownClientToken");
    this._settings = {
      identity: settings.identity,
      serializers: (settings.serializers ?? defaultSerializersOrTypes).map(getTypeSerializerClass),
      intrinsicSerializers: settings.intrinsicSerializers ?? defaultIntrinsicSerializers,
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
  registerClient(settings) {
    const clientToken = JSON.parse(JSON.stringify(settings));
    this._clients.add(clientToken);
    return clientToken;
  }
  get registeredClientTokens() {
    return Array.from(this._clients).filter((c) => c !== this._ownClientToken);
  }
  removeClient(clientToken) {
    if (!this._clients.has(clientToken)) {
      throw new Error("Unknown client token");
    }
    this._objectPool.infos.forEach((info) => {
      info.serializer.onClientRemoved(clientToken);
    });
    this._clients.delete(clientToken);
  }
  get identity() {
    return this._settings.identity;
  }
  get allTrackedObjects() {
    return this._objectPool.objects;
  }
  setClientRestriction(obj, filter) {
    const info = this._objectPool.getInfoByObject(obj);
    if (!info)
      throw new Error("Object is not tracked");
    info.setClientRestriction(filter);
  }
  track(instance, objectId) {
    const info = this.trackInternal(instance, objectId);
    if (!info) {
      throw new Error("Cannot track primitive value as root.");
    }
    info.isRoot = true;
    info.serializer.clients.add(this._ownClientToken);
  }
  trackInternal(instance, objectId) {
    if (isPrimitiveValue(instance))
      return null;
    let info = this._objectPool.getInfoByObject(instance);
    if (info) {
      return info;
    }
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
    info.initializeSerializer(instance);
    return info;
  }
  untrack(instance) {
    const info = this._objectPool.getInfoByObject(instance);
    if (!info || !info.isRoot)
      return false;
    info.isRoot = false;
    return true;
  }
  reportInstanceCreated(instance, objectId) {
    this.trackInternal(instance, objectId);
  }
  findSerializer(instanceOrTypeId) {
    const serializer = this._settings.serializers.find((s) => s.canSerialize(instanceOrTypeId)) ?? this._settings.intrinsicSerializers.find((s) => s.canSerialize(instanceOrTypeId));
    if (!serializer)
      throw new Error(`No serializer found for value of type ${typeof instanceOrTypeId === "string" ? instanceOrTypeId : instanceOrTypeId.constructor.name}`);
    return serializer;
  }
  handleCreateMessage(message, clientToken) {
    this._pendingCreateMessageByObjectId.delete(message.objectId);
    const info = new ObjectInfo(this, message.objectId, message.typeId);
    this._objectPool.add(info);
    info.initializeSerializer(message.typeId);
    info.serializer.clients.add(clientToken);
    info.serializer.applyMessage(message, clientToken);
  }
  async handleOtherMessage(message, clientToken) {
    const info = this._objectPool.getInfoById(message.objectId);
    if (!info)
      return;
    await info.serializer.applyMessage(message, clientToken);
  }
  async handleDeleteMessage(message, clientToken) {
    const info = this._objectPool.getInfoById(message.objectId);
    if (!info)
      return;
    await info.serializer.applyMessage(message, clientToken);
    this._objectPool.deleteById(message.objectId);
  }
  serializeValue(value, clientToken) {
    if (isPrimitiveValue(value)) {
      return {
        value
      };
    }
    const objectInfo = this.trackInternal(value);
    const typeId = objectInfo.serializer.getTypeId(clientToken);
    if (typeId === void 0 || typeId === null) {
      return void 0;
    }
    return { objectId: objectInfo.objectId, typeId };
  }
  deserializeValue(value, clientToken) {
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
    if (messagesOrMessagesByClient instanceof Map) {
      for (const [clientToken2, messages2] of messagesOrMessagesByClient) {
        await this.applyMessagesAsync(messages2, clientToken2);
      }
      return;
    }
    let messages = messagesOrMessagesByClient;
    if (this._clients.has(clientToken) === false) {
      throw new Error("Unknown client token received messages from.");
    }
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
      this._pendingCreateMessageByObjectId.set(creationMessage.objectId, creationMessage);
    }
    while (this._pendingCreateMessageByObjectId.size > 0) {
      const creationMessage = this._pendingCreateMessageByObjectId.values().next().value;
      this.handleCreateMessage(creationMessage, clientToken);
    }
    for (const message of messages) {
      if (isDeleteObjectMessage(message))
        await this.handleDeleteMessage(message, clientToken);
      else
        await this.handleOtherMessage(message, clientToken);
    }
  }
  clearStates() {
    this._objectPool.infos.forEach((info) => {
      info.serializer.clearStates();
    });
    this._objectsWithPendingMessages.clear();
    this._objectPool.orphanedObjectInfos(this._ownClientToken).forEach((info) => {
      this._objectPool.deleteByObject(info.instance);
    });
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
        if (!objectInfo.isForClientToken(clientToken))
          continue;
        serializersWhichsStatesNeedsToBeCleared.add(objectInfo.serializer);
        const isNewInstance = objectInfo.serializer.clients.has(clientToken) === false;
        if (isNewInstance) {
          objectInfo.serializer.clients.add(clientToken);
        }
        const messages = objectInfo.serializer.generateMessages(clientToken, isNewInstance);
        generatedMessages.push(...messages);
      }
      for (const serializer of serializersWhichsStatesNeedsToBeCleared)
        serializer.clearStates(clientToken);
      while (true) {
        const noLongerTrackedByClient = this._objectPool.objectInfosToDelete(clientToken);
        if (noLongerTrackedByClient.length === 0) {
          break;
        }
        for (const objectInfo of noLongerTrackedByClient) {
          if (this._settings.memoryManagementMode === "byClient") {
            objectInfo.serializer.onClientRemoved(clientToken);
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
  findOne(constructorOrObjectId, objectId) {
    if (typeof constructorOrObjectId === "string") {
      return this._objectPool.getObjectById(constructorOrObjectId);
    }
    return this._objectPool.findOne(constructorOrObjectId, objectId);
  }
  findAll(constructor) {
    return this._objectPool.findAll(constructor);
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
  getDispatcher(instance) {
    const info = this._objectPool.getInfoByObject(instance);
    if (!info)
      throw new Error("Object is not tracked");
    const dispatcher = info.serializer.dispatcher;
    if (!dispatcher) {
      return null;
    }
    return dispatcher;
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
  hostSync.applyMessagesAsync(messages, clientToken);
  const root = hostSync.findOne("root");
  if (root)
    return root;
  const primitive = hostSync.findOne("value");
  if (primitive)
    return primitive.value;
  throw new Error("Deserialized data does not contain a root or primitive value");
}
async function deserializeValueAsync(data, settings) {
  const hostSync = new ObjectSync({ ...settings, identity: settings?.clientIdentity ?? "client" });
  const clientToken = hostSync.registerClient({ identity: settings?.identity ?? "host" });
  const messages = JSON.parse(data);
  await hostSync.applyMessagesAsync(messages, clientToken);
  const root = hostSync.findOne("root");
  if (root)
    return root;
  const primitive = hostSync.findOne("value");
  if (primitive)
    return primitive.value;
  throw new Error("Deserialized data does not contain a root or primitive value");
}
export {
  ArraySerializer,
  ChangeMessageType,
  CreateMessageType,
  DeleteMessageType,
  EventEmitter,
  ExecuteFinishedMessageType,
  ExecuteMessageType,
  ExtendedTypeSerializer,
  MapSerializer,
  ObjectSerializer,
  ObjectSync,
  SetSerializer,
  SyncableArray,
  SyncableArraySerializer,
  SyncableMapSerializer,
  SyncableObservableArray,
  SyncableObservableArraySerializer,
  SyncableSetSerializer,
  TypeSerializer,
  createSimpleTypeSerializerClass,
  defaultIntrinsicSerializers,
  defaultSerializersOrTypes,
  deserializeValue,
  deserializeValueAsync,
  getTrackableTypeInfo,
  isChangeObjectMessage,
  isCreateObjectMessage,
  isDeleteObjectMessage,
  isExecuteFinishedObjectMessage,
  isExecuteObjectMessage,
  nothing,
  serializeValue,
  syncMethod,
  syncObject,
  syncProperty
};
//# sourceMappingURL=index.js.map
