import {
  Constructor,
  forEachIterable,
  isIterable,
  isPromiseLike,
  OneOrMany,
  ChangeObjectMessage,
  CreateObjectMessage,
  ExecuteFinishedObjectMessage,
  ExecuteObjectMessage,
  Message,
  MethodExecuteResult,
  ClientToken,
  getMetaInfo,
  SerializedValue,
} from "../../../shared/index.js";
import { ExtendedSyncAgent } from "../../extendedSyncAgent.js";
import { beforeExecuteOnClient, getSyncMethodInfo } from "./decorators/syncMethod.js";
import { beforeSendObjectToClient, getTrackableTypeInfo, TrackableConstructorInfo } from "./decorators/syncObject.js";
import { beforeSendPropertyToClient, checkCanApplyProperty, TrackedPropertyInfo, TrackedPropertySettings } from "./decorators/syncProperty.js";
import { ObjectSyncMetaInfo } from "./metaInfo.js";
import { nothing } from "./types.js";
import { ObjectInfo } from "../../objectInfo.js";
import { ISyncAgent } from "../../syncAgent.js";

type PropertyValueInfo = {
  value: any;
  hasPendingChanges: boolean;
  propertyInfo: TrackedPropertySettings<any, any>;
};

const constructorPropertyName = "[[constructor]]";

type TPayload = {
  [propertyKey: string]: SerializedValue;
} & {
  "[[constructor]]"?: SerializedValue[];
};

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

type MethodReturnType<T extends object, K extends keyof T> = T[K] extends (...args: any[]) => infer U ? UnwrapPromise<U> : never;

type InvokeMethodClientInfo = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  sentToClient: boolean;
};
type InvokeMethodInfo = {
  id: unknown;
  invokeMethodInfoByClient: Map<ClientToken, InvokeMethodClientInfo>;
  methodName: string;
  parameters: any[];
};

export interface ISyncObjectSyncAgent<TInstance extends object = object> extends ISyncAgent<TInstance> {
  /**
   * Invokes a method on all currently known clients.
   * @param method The method name to invoke.
   * @param args The method arguments.
   * @return A map of client tokens to promises of the method return values.
   */
  invoke<TMethodName extends keyof TInstance>(
    method: TMethodName,
    ...args: TInstance[TMethodName] extends (...a: infer P) => any ? P : never
  ): Map<ClientToken, Promise<MethodReturnType<TInstance, TMethodName>>>;

  /**
   * Invokes a method on the specified client.
   * @param clientToken The client token to invoke the method on.
   * @param method The method name to invoke.
   * @param args The method arguments.
   * @return A promise of the method return value.
   */
  invoke<TMethodName extends keyof TInstance>(
    clientToken: ClientToken,
    method: TMethodName,
    ...args: TInstance[TMethodName] extends (...a: infer P) => any ? P : never
  ): Promise<MethodReturnType<TInstance, TMethodName>>;

  /**
   * Invokes a method on multiple specified clients.
   * @param clients Multiple client tokens to invoke the method on.
   * @param method The method name to invoke.
   * @param args The method arguments.
   * @return A map of client tokens to promises of the method return values.
   */
  invoke<TMethodName extends keyof TInstance>(
    clients: Iterable<ClientToken>,
    method: TMethodName,
    ...args: TInstance[TMethodName] extends (...a: infer P) => any ? P : never
  ): Map<ClientToken, Promise<MethodReturnType<TInstance, TMethodName>>>;
}

export abstract class SyncObjectSyncAgent<TInstance extends object> extends ExtendedSyncAgent<TInstance, TPayload> implements ISyncObjectSyncAgent<TInstance> {
  private _typeInfo: TrackableConstructorInfo<TInstance> = null!;

  private readonly _properties: Map<keyof TInstance & string, PropertyValueInfo> = new Map();
  private readonly _pendingInvokeMethodInfosById: Map<unknown, InvokeMethodInfo> = new Map();
  private _methodInvokeResultsByClient: Map<ClientToken, MethodExecuteResult[]> = new Map();
  private _nextInvokeId: number = 0;

  constructor(
    objectInfo: ObjectInfo<TInstance>,
    private readonly _typeId: string,
  ) {
    super(objectInfo);

    this.registerMessageHandler<ExecuteObjectMessage<TInstance, string & keyof TInstance>>("execute", (message, clientToken) => this.onExecuteMessageReceived(message, clientToken));
    this.registerMessageHandler<ExecuteFinishedObjectMessage>("executeFinished", (message, clientToken) => this.onExecuteFinishedMessageReceived(message, clientToken));
  }

  override onInstanceSet(createdByCreateObjectMessage: boolean) {
    super.onInstanceSet(createdByCreateObjectMessage);

    const metaInfo = getMetaInfo(this.instance, ObjectSyncMetaInfo, true);
    metaInfo?.on("propertyChanged", (propertyInfo, instance, propertyKey, value) => {
      this.reportPropertyChanged(propertyInfo, propertyKey as keyof TInstance & string, value);
    });

    this._typeInfo = getTrackableTypeInfo<TInstance>((this.instance as any).constructor)!;
    this._typeInfo.trackedProperties.forEach((propertyInfo, key) => {
      this.reportPropertyChanged(propertyInfo, key as keyof TInstance & string, (this.instance as any)[key]);
    });
  }

  abstract get type(): Constructor;

  onCreateMessageReceived(message: CreateObjectMessage<TPayload>, clientToken: ClientToken) {
    const typeInfo = getTrackableTypeInfo<TInstance>(this.type)!;
    const constructorArguments = (message.data[constructorPropertyName] ?? []).map((arg: any, index) => {
      return this.deserializeValue(arg, clientToken, typeInfo.allowedConstructorParameterTypesFromSender ? (typeInfo.allowedConstructorParameterTypesFromSender[index] ?? []) : undefined);
    });

    this.instance = new (this.type as Constructor<TInstance>)(...constructorArguments);
    const possiblePromise = this.onChangeMessageReceived(message as unknown as ChangeObjectMessage<TPayload>, clientToken);
    if (isPromiseLike(possiblePromise)) {
      throw new Error("onChangeMessageReceived cannot be async when receiving a create message because the instance needs to be created synchronously.");
    }

    this._properties.forEach((propertyValueInfo, propertyKey) => {
      propertyValueInfo.hasPendingChanges = false;
    });
  }

  override onChangeMessageReceived(message: ChangeObjectMessage<TPayload>, clientToken: ClientToken) {
    for (const key of Object.keys(message.data)) {
      if (key === constructorPropertyName) continue;
      if (!checkCanApplyProperty(this.instance.constructor as Constructor, this.instance, key, false, clientToken)) continue;

      const property = this._properties.get(key as any);
      if (!property) {
        throw new Error(`Received change for untracked property '${key}' on object with id ${this.objectId}.`);
      }

      const originalValue = (this.instance as any)[key];
      const value = this.deserializeValue(message.data[key], clientToken, property.propertyInfo.allowedTypesFromSender);
      if (originalValue === value) continue;

      (this.instance as any)[key] = value;
      const self = this;
      property.propertyInfo.afterValueChanged?.call(this.instance, {
        instance: this.instance,
        key: key as keyof TInstance & string,
        value,
        sourceClientToken: clientToken,
        get syncAgent() {
          return self._objectInfo.owner.getSyncAgentOrNull(value);
        },
      });
    }
  }

  onExecuteMessageReceived(message: ExecuteObjectMessage<TInstance, string & keyof TInstance>, clientToken: ClientToken) {
    const finishInvoke = (result: any, error: any) => {
      let methodInvokeResults = this._methodInvokeResultsByClient.get(clientToken);
      if (!methodInvokeResults) {
        methodInvokeResults = [];
        this._methodInvokeResultsByClient.set(clientToken, methodInvokeResults);
      }

      if (error) methodInvokeResults.push({ objectId: message.objectId, invokeId: message.invokeId, error });
      else methodInvokeResults.push({ objectId: message.objectId, invokeId: message.invokeId, result });

      this.reportPendingMessages();
    };

    const method = this.instance[message.method];
    if (typeof method !== "function") {
      finishInvoke(null, new Error(`Target with id ${message.objectId} has no method ${message.method}`));
      return;
    }

    const constructorInfo = getTrackableTypeInfo(this.instance.constructor as Constructor);
    const methodInfo = constructorInfo!.trackedMethods.get(message.method);
    if (!methodInfo) {
      finishInvoke(null, new Error(`Method ${message.method} is not a tracked method on object with id ${this.objectId}.`));
      return;
    }

    if (!checkCanApplyProperty(this.instance.constructor as Constructor, this.instance, message.method, true, clientToken)) {
      finishInvoke(null, new Error("Not allowed."));
      return;
    }

    let resultOrPromise: any;
    try {
      const parameters = message.parameters.map((value, index) => {
        return this.deserializeValue(value, clientToken, methodInfo.allowedParameterTypesFromSender ? (methodInfo.allowedParameterTypesFromSender[index] ?? []) : undefined);
      });
      resultOrPromise = method.apply(this.instance, parameters);
    } catch (e) {
      finishInvoke(null, e);
      return;
    }

    // Store reply, handle Promise
    if (isPromiseLike(resultOrPromise)) {
      const promise = resultOrPromise.then(
        (result: any) => {
          finishInvoke(result, null);
        },
        (error: any) => {
          finishInvoke(null, error);
        },
      );

      const promiseHandlingType = getSyncMethodInfo(this.instance.constructor as Constructor, message.method)?.promiseHandlingType ?? "normal";
      if (promiseHandlingType === "await") {
        this._objectInfo.owner.registerPendingPromise(promise);
      }
    } else {
      // Synchronous result
      finishInvoke(resultOrPromise, null);
    }
  }

  onExecuteFinishedMessageReceived(message: ExecuteFinishedObjectMessage, clientToken: ClientToken) {
    const pendingCall = this._pendingInvokeMethodInfosById.get(message.invokeId);
    if (!pendingCall) return;

    const clientPromiseInfo = pendingCall.invokeMethodInfoByClient.get(clientToken);
    if (!clientPromiseInfo) return;

    if ("error" in message) {
      clientPromiseInfo.reject(message.error);
    } else {
      clientPromiseInfo.resolve(message.result);
    }
  }

  private generateCreateMessage(typeId: string, clientToken: ClientToken): CreateObjectMessage<TPayload> {
    const data: TPayload = {};

    // Extract explicit constructor arguments when possible
    const propertiesToOmit: Set<string> = new Set();
    if (this._typeInfo.constructorArguments !== undefined) {
      const constructorArgumentsResult =
        typeof this._typeInfo.constructorArguments === "function"
          ? this._typeInfo.constructorArguments.call(this.instance, { instance: this.instance, constructor: this.type, typeId, destinationClientToken: clientToken })
          : this._typeInfo.constructorArguments;

      const finalConstructorArguments: any[] = (data[constructorPropertyName] = []);

      if (Array.isArray(constructorArgumentsResult)) {
        constructorArgumentsResult.forEach((propertyKey) => {
          propertiesToOmit.add(propertyKey);
          const propertyValueInfo = this._properties.get(propertyKey as keyof TInstance & string);
          if (!propertyValueInfo) {
            throw new Error(`Cannot use property '${propertyKey}' as constructor argument for type '${this._typeId}' because it is not a tracked property.`);
          }

          const value = propertyValueInfo.value;
          const beforeSendResult = beforeSendPropertyToClient(this.instance.constructor as Constructor, this.instance, propertyKey, value, clientToken);
          if (beforeSendResult.skip) return;

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
      if (propertiesToOmit.has(propertyKey)) return;

      const value = propertyValueInfo.value;
      const beforeSendResult = beforeSendPropertyToClient(this.instance.constructor as Constructor, this.instance, propertyKey, value, clientToken);
      if (beforeSendResult.skip) return;

      data[propertyKey as string] = this.serializeValue({ value: beforeSendResult.value, key: propertyKey, clientToken });
    });

    return this.createMessage("create", data, typeId);
  }

  private generateChangeMessage(typeId: string, clientToken: ClientToken): ChangeObjectMessage<TPayload> | null {
    const data: TPayload = {};
    let hasDataToSend = false;
    this._properties.forEach((propertyValueInfo, propertyKey) => {
      if (!propertyValueInfo.hasPendingChanges) return;

      const value = propertyValueInfo.value;
      const beforeSendResult = beforeSendPropertyToClient(this.instance.constructor as Constructor, this.instance, propertyKey, value, clientToken);
      if (beforeSendResult.skip) return;

      const transformedValue = this.serializeValue({ value: beforeSendResult.value, key: propertyKey, clientToken });
      data[propertyKey as string] = transformedValue;
      hasDataToSend = true;
    });

    if (!hasDataToSend) return null;

    return this.createMessage("change", data);
  }

  generateMessages(clientToken: ClientToken, isNewClient: boolean): Message[] {
    const result: Message[] = [];
    let typeId = this.getTypeId(clientToken);
    if (typeId === null) {
      // Object should not be sent to client
      return result;
    }

    if (isNewClient || this.hasPendingChanges) {
      if (isNewClient) result.push(this.generateCreateMessage(typeId, clientToken));
      else {
        const changeMessage = this.generateChangeMessage(typeId, clientToken);
        if (changeMessage) result.push(changeMessage);
      }
    }

    this.generateExecuteMessages(typeId, clientToken, result);
    this.generateExecuteResultMessages(typeId, clientToken, result);

    return result;
  }

  private generateExecuteMessages(typeId: string, clientToken: ClientToken, result: Message[]) {
    for (const pendingInvokeMethodInfos of this._pendingInvokeMethodInfosById.values()) {
      const clientInvokeInfo = pendingInvokeMethodInfos.invokeMethodInfoByClient.get(clientToken);
      if (!clientInvokeInfo || clientInvokeInfo.sentToClient) continue;
      clientInvokeInfo.sentToClient = true;

      const args = pendingInvokeMethodInfos.parameters.slice();
      if (beforeExecuteOnClient(this.instance.constructor as Constructor, this.instance, pendingInvokeMethodInfos.methodName, args, clientToken) === false) {
        clientInvokeInfo.reject("Not allowed to invoke method.");
        continue;
      }

      const parameters = args.map((arg) => {
        const transformedValue = this.serializeValue(arg, clientToken);
        return transformedValue;
      });

      const executeMessage = this.createMessage<ExecuteObjectMessage>("execute", {
        invokeId: pendingInvokeMethodInfos.id,
        method: pendingInvokeMethodInfos.methodName,
        parameters,
      });
      result.push(executeMessage);
    }
  }

  private generateExecuteResultMessages(typeId: string, clientToken: ClientToken, result: Message[]) {
    const methodInvokeResults = this._methodInvokeResultsByClient.get(clientToken);
    if (methodInvokeResults) {
      this._methodInvokeResultsByClient.delete(clientToken);
      for (const methodInvokeResult of methodInvokeResults ?? []) {
        const executeFinishedMessage = this.createMessage<ExecuteFinishedObjectMessage>("executeFinished", {
          invokeId: methodInvokeResult.invokeId,
        });

        if ("result" in methodInvokeResult) executeFinishedMessage.result = this.serializeValue(methodInvokeResult.result, clientToken);
        if ("error" in methodInvokeResult) executeFinishedMessage.error = this.serializeValue(methodInvokeResult.error, clientToken);

        result.push(executeFinishedMessage);
      }
    }
  }

  getTypeId(clientToken: ClientToken) {
    const typeIdOrNothing = beforeSendObjectToClient(this.type, this.instance, this._typeId, clientToken);
    if (typeIdOrNothing === nothing) return null;

    return typeIdOrNothing;
  }

  reportPropertyChanged<TKey extends keyof TInstance & string>(propertyInfo: TrackedPropertyInfo<any, any>, key: TKey, value: TInstance[TKey]) {
    if (!this.checkCanTrackPropertyInfo(propertyInfo, this.instance, key)) return;

    let property = this._properties.get(key);
    if (!property) {
      property = {
        hasPendingChanges: true,
        value: undefined,
        propertyInfo,
      };
      this._properties.set(key, property);
      this.hasPendingChanges = true;
    }
    if (property.value === value) return;

    this.clearStoredReferences(key);

    property.value = value;

    if (this.isApplyingMessages) return;
    else {
      const self = this;
      property.propertyInfo.afterValueChanged?.call(this.instance, {
        instance: this.instance,
        key: key as keyof TInstance & string,
        value,
        sourceClientToken: null,
        get syncAgent() {
          return self._objectInfo.owner.getSyncAgentOrNull(value);
        },
      });
    }

    property.hasPendingChanges = true;
    this.hasPendingChanges = true;
  }

  clearStates(clientToken?: ClientToken) {
    super.clearStates(clientToken);

    if (clientToken) {
      this._methodInvokeResultsByClient.delete(clientToken);
    } else {
      this._properties.forEach((property) => {
        property.hasPendingChanges = false;
      });
    }
  }

  private checkCanTrackPropertyInfo(propertyInfo: TrackedPropertyInfo<TInstance, any> | undefined, instance: TInstance, propertyKey: string) {
    if (!propertyInfo) {
      return false;
    }
    if (propertyInfo.canTrack?.call(instance, { instance, key: propertyKey as any }) === false) {
      return false;
    }
    return true;
  }

  invoke<TMethodName extends keyof TInstance>(
    method: TMethodName,
    ...args: TInstance[TMethodName] extends (...a: infer P) => any ? P : never
  ): Map<ClientToken, Promise<MethodReturnType<TInstance, TMethodName>>>;

  invoke<TMethodName extends keyof TInstance>(
    clientToken: ClientToken,
    method: TMethodName,
    ...args: TInstance[TMethodName] extends (...a: infer P) => any ? P : never
  ): Promise<MethodReturnType<TInstance, TMethodName>>;

  invoke<TMethodName extends keyof TInstance>(
    clients: Iterable<ClientToken>,
    method: TMethodName,
    ...args: TInstance[TMethodName] extends (...a: infer P) => any ? P : never
  ): Map<ClientToken, Promise<MethodReturnType<TInstance, TMethodName>>>;

  invoke(clientOrClientsOrMethodName: OneOrMany<ClientToken> | string, ...args: any[]) {
    if (typeof clientOrClientsOrMethodName === "string") {
      const methodName = clientOrClientsOrMethodName;
      return this.invokeMethodForClients(undefined, methodName as keyof TInstance & string, ...(args as any));
    } else {
      const clientOrClients = clientOrClientsOrMethodName;
      const methodName = args.shift() as keyof TInstance & string;
      const result = this.invokeMethodForClients(clientOrClients, methodName, ...(args as any));

      if (isIterable(clientOrClients)) {
        return result;
      } else {
        const client = clientOrClients as ClientToken;
        return result.get(client)!;
      }
    }
  }

  private invokeMethodForClients<TMethodName extends keyof TInstance & string>(
    clientOrClients: OneOrMany<ClientToken> | undefined,
    methodName: TMethodName,
    ...parameters: TInstance[TMethodName] extends (...a: infer P) => any ? P : never
  ): Map<ClientToken, Promise<MethodReturnType<TInstance, TMethodName>>> {
    const clients = clientOrClients ?? this._objectInfo.owner.registeredClientTokens;

    const methodInfo = this._typeInfo.trackedMethods.get(methodName);
    if (!methodInfo) {
      throw new Error(`Cannot invoke method '${methodName}' on object with id ${this.objectId} because it is not a tracked method.`);
    }

    const resultByClient: Map<ClientToken, Promise<MethodReturnType<TInstance, TMethodName>>> = new Map();

    if (!this.checkCanTrackPropertyInfo(methodInfo, this.instance, methodName)) {
      forEachIterable(clients, (c) => {
        resultByClient.set(c, Promise.reject<MethodReturnType<TInstance, TMethodName>>(new Error(`Not allowed to invoke method ${methodName} on object ${this.objectId}.`)));
      });
      return resultByClient;
    }

    const id = this._nextInvokeId++;

    const invokeMethodInfo: InvokeMethodInfo = {
      id,
      methodName,
      parameters,
      invokeMethodInfoByClient: new Map(),
    };

    forEachIterable(clients, (clientToken) => {
      const onPromiseFinished = () => {
        invokeMethodInfo.invokeMethodInfoByClient.delete(clientToken);
        if (invokeMethodInfo.invokeMethodInfoByClient.size === 0) {
          this._pendingInvokeMethodInfosById.delete(id);
        }
      };

      const promise = new Promise<MethodReturnType<TInstance, TMethodName>>((res, rej) => {
        invokeMethodInfo.invokeMethodInfoByClient.set(clientToken, {
          resolve: (data) => {
            onPromiseFinished();

            const result = this.deserializeValue(data, clientToken, methodInfo.allowedReturnTypesFromSender) as MethodReturnType<TInstance, TMethodName>;
            res(result);
          },
          reject: (data) => {
            onPromiseFinished();

            const error = this.deserializeValue(data, clientToken, methodInfo.allowedRejectionTypesFromSender);
            rej(error);
          },
          sentToClient: false,
        });
      });

      resultByClient.set(clientToken, promise);
    });

    this._pendingInvokeMethodInfosById.set(invokeMethodInfo.id, invokeMethodInfo);
    this.reportPendingMessages();

    return resultByClient;
  }
}
