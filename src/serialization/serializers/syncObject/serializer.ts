import { ExtendedTypeSerializer } from "../../serializer.js";
import { ChangeObjectMessage, CreateObjectMessage, ExecuteFinishedObjectMessage, ExecuteObjectMessage, Message, MethodExecuteResult } from "../../../shared/messages.js";
import { ObjectInfo, StoredReference } from "../../../shared/objectInfo.js";
import { Constructor, forEachIterable, isIterable, isPrimitiveValue, isPromiseLike, OneOrMany } from "../../../shared/types.js";
import { ClientToken } from "../../../shared/clientToken.js";
import { ensureObjectSyncMetaInfo, nothing } from "../../../decorators/base.js";
import { beforeExecuteOnClient, getSyncMethodInfo } from "../../../decorators/syncMethod.js";
import { beforeSendObjectToClient, getTrackableTypeInfo, TrackableConstructorInfo } from "../../../decorators/syncObject.js";
import { beforeSendPropertyToClient, checkCanApplyProperty, TrackedPropertyInfo, TrackedPropertySettingsBase } from "../../../decorators/syncProperty.js";

type PropertyValueInfo = {
  value: any;
  hasPendingChanges: boolean;
  propertyInfo?: TrackedPropertySettingsBase<any>;
  isBeeingApplied: boolean;
};

type TPayload = Partial<{
  [propertyKey: string]: any;
}>;

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

export interface ISyncObjectDispatcher<TInstance extends object = object> {
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

export abstract class SyncObjectSerializer<TInstance extends object> extends ExtendedTypeSerializer<TInstance, TPayload> {
  private _typeInfo: TrackableConstructorInfo<TInstance> = null!;

  private readonly _properties: Map<keyof TInstance & string, PropertyValueInfo> = new Map();
  private readonly _temporaryReferencesByClient: Map<ClientToken, StoredReference[]> = new Map();
  private readonly _pendingInvokeMethodInfosById: Map<unknown, InvokeMethodInfo> = new Map();
  private _methodInvokeResultsByClient: Map<ClientToken, MethodExecuteResult[]> = new Map();
  private _nextInvokeId = 1;
  private _dispatcher: ISyncObjectDispatcher | undefined;

  constructor(objectInfo: ObjectInfo<TInstance>) {
    super(objectInfo);

    this.registerMessageHandler<ExecuteObjectMessage<TInstance, string & keyof TInstance>>("execute", (message, clientToken) => this.onExecuteMessageReceived(message, clientToken));
    this.registerMessageHandler<ExecuteFinishedObjectMessage>("executeFinished", (message, clientToken) => this.onExecuteFinishedMessageReceived(message, clientToken));
  }

  private createTemporaryReference(value: any, clientToken: ClientToken) {
    if (isPrimitiveValue(value)) {
      return {
        dispose() {},
      };
    }

    const storedReference = this._objectInfo.owner.trackInternal(value)!.addReference(clientToken);
    let tempRefs = this._temporaryReferencesByClient.get(clientToken);
    if (!tempRefs) {
      tempRefs = [];
      this._temporaryReferencesByClient.set(clientToken, tempRefs);
    }
    tempRefs.push(storedReference);
    return storedReference;
  }

  override onInstanceSet(createdByCreateObjectMessage: boolean) {
    super.onInstanceSet(createdByCreateObjectMessage);

    const metaInfo = ensureObjectSyncMetaInfo(this.instance);
    metaInfo?.on("propertyChanged", (propertyInfo, instance, propertyKey, value) => {
      this.reportPropertyChanged(propertyInfo, propertyKey as keyof TInstance & string, value);
    });

    if (createdByCreateObjectMessage) return;

    this._typeInfo = getTrackableTypeInfo<TInstance>((this.instance as any).constructor)!;
    this._typeInfo.trackedProperties.forEach((propertyInfo, key) => {
      this.reportPropertyChanged(propertyInfo, key as keyof TInstance & string, (this.instance as any)[key]);
    });
  }

  abstract get type(): Constructor;
  abstract get typeId(): string;

  async onCreateMessageReceived(message: CreateObjectMessage<TPayload>, clientToken: ClientToken) {
    const constructorArguments = (message.data["[[constructor]]"] ?? []).map((arg: any) => {
      return this.deserializeValue(arg, clientToken);
    });

    this.instance = new (this.type as Constructor<TInstance>)(...constructorArguments);
    await this.onChangeMessageReceived(message as unknown as ChangeObjectMessage<TPayload>, clientToken);

    this._properties.forEach((propertyValueInfo, propertyKey) => {
      propertyValueInfo.hasPendingChanges = false;
    });
  }

  override onChangeMessageReceived(message: ChangeObjectMessage<TPayload>, clientToken: ClientToken) {
    for (const key of Object.keys(message.data)) {
      if (!checkCanApplyProperty(this.instance.constructor as Constructor, this.instance, key, false, clientToken)) continue;

      const value = this.deserializeValue(message.data[key], clientToken);
      const property = this._properties.get(key as any);
      try {
        if (property) property.isBeeingApplied = true;
        (this.instance as any)[key] = value;
      } finally {
        if (property) property.isBeeingApplied = false;
      }
    }
  }

  async onExecuteMessageReceived(message: ExecuteObjectMessage<TInstance, string & keyof TInstance>, clientToken: ClientToken) {
    if (typeof this.instance[message.method] !== "function") {
      throw new Error(`Target with id ${message.objectId} has no method ${message.method}`);
    }

    const finishInvoke = (result: any, error: any) => {
      let methodInvokeResults = this._methodInvokeResultsByClient.get(clientToken);
      if (!methodInvokeResults) {
        methodInvokeResults = [];
        this._methodInvokeResultsByClient.set(clientToken, methodInvokeResults);
      }

      if (error) methodInvokeResults.push({ objectId: message.objectId, invokeId: message.id, error });
      else methodInvokeResults.push({ objectId: message.objectId, invokeId: message.id, result });

      this.reportPendingMessages();
    };

    if (!checkCanApplyProperty(this.instance.constructor as Constructor, this.instance, message.method, true, clientToken)) {
      finishInvoke(null, "Not allowed.");
      return;
    }

    const parameters = message.parameters.map((value) => {
      return this.deserializeValue(value, clientToken);
    });

    let resultOrPromise: any;
    try {
      resultOrPromise = (this.instance as any)[message.method](...parameters);
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
      if (promiseHandlingType === "await") await promise;
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
          ? this._typeInfo.constructorArguments.call(this.instance, { instance: this.instance, constructor: this.type, typeId, destinationClientConnection: clientToken })
          : this._typeInfo.constructorArguments;

      const finalConstructorArguments: any[] = (data["[[constructor]]"] = []);

      if (Array.isArray(constructorArgumentsResult)) {
        constructorArgumentsResult.forEach((propertyKey) => {
          propertiesToOmit.add(propertyKey);
          const propertyValueInfo = this._properties.get(propertyKey as keyof TInstance & string);
          if (!propertyValueInfo) {
            throw new Error(`Cannot use property '${propertyKey}' as constructor argument for type '${this.typeId}' because it is not a tracked property.`);
          }

          const value = propertyValueInfo.value;
          const finalValue = beforeSendPropertyToClient(this.instance.constructor as Constructor, this.instance, propertyKey, value, clientToken);
          if (finalValue === nothing) {
            this.storeReference(undefined, propertyKey, clientToken);
            return;
          }

          this.storeReference(finalValue, propertyKey, clientToken);
          finalConstructorArguments.push(this.serializeValue(finalValue, clientToken));
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
      const finalValue = beforeSendPropertyToClient(this.instance.constructor as Constructor, this.instance, propertyKey, value, clientToken);
      if (finalValue === nothing) {
        this.storeReference(undefined, propertyKey, clientToken);
        return;
      }

      this.storeReference(finalValue, propertyKey, clientToken);

      const transformedValue = this.serializeValue(finalValue, clientToken);
      data[propertyKey] = transformedValue;
    });

    const createMessage: CreateObjectMessage = {
      type: "create",
      objectId: this.objectId,
      typeId,
      data,
    };

    return createMessage;
  }

  private generateChangeMessage(clientToken: ClientToken): ChangeObjectMessage<TPayload> | null {
    const data: TPayload = {};
    let hasDataToSend = false;
    this._properties.forEach((propertyValueInfo, propertyKey) => {
      if (!propertyValueInfo.hasPendingChanges) return;

      const value = propertyValueInfo.value;
      const finalValue = beforeSendPropertyToClient(this.instance.constructor as Constructor, this.instance, propertyKey, value, clientToken);
      if (finalValue === nothing) {
        this.storeReference(undefined, propertyKey, clientToken);
        return;
      }

      this.storeReference(finalValue, propertyKey, clientToken);

      const transformedValue = this.serializeValue(finalValue, clientToken);
      data[propertyKey] = transformedValue;
      hasDataToSend = true;
    });

    if (!hasDataToSend) return null;

    const changeMessage: ChangeObjectMessage = {
      type: "change",
      objectId: this.objectId,
      data,
    };

    return changeMessage;
  }

  generateMessages(clientToken: ClientToken, isNewClientConnection: boolean): Message[] {
    const result: Message[] = [];

    if (isNewClientConnection || this.hasPendingChanges) {
      let typeId = this.getTypeId(clientToken);
      if (typeId === null) {
        // Object should not be sent to client
        return result;
      }

      if (isNewClientConnection) result.push(this.generateCreateMessage(typeId, clientToken));
      else {
        const changeMessage = this.generateChangeMessage(clientToken);
        if (changeMessage) result.push(changeMessage);
      }
    }

    this.generateExecuteMessages(clientToken, result);
    this.generateExecuteResultMessages(clientToken, result);

    return result;
  }

  private generateExecuteResultMessages(clientToken: ClientToken, result: Message[]) {
    const methodInvokeResults = this._methodInvokeResultsByClient.get(clientToken);
    if (methodInvokeResults) {
      this._methodInvokeResultsByClient.delete(clientToken);
      for (const methodInvokeResult of methodInvokeResults ?? []) {
        const executeFinishedMessage: ExecuteFinishedObjectMessage = {
          type: "executeFinished",
          objectId: methodInvokeResult.objectId,
          invokeId: methodInvokeResult.invokeId,
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

  private generateExecuteMessages(clientToken: ClientToken, result: Message[]) {
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
        this.createTemporaryReference(arg, clientToken);
        const transformedValue = this.serializeValue(arg, clientToken);
        return transformedValue;
      });

      const executeMessage: ExecuteObjectMessage = {
        id: pendingInvokeMethodInfos.id,
        type: "execute",
        objectId: this.objectId,
        method: pendingInvokeMethodInfos.methodName,
        parameters,
      };
      result.push(executeMessage);
    }
  }

  getTypeId(clientToken: ClientToken) {
    const typeIdOrNothing = beforeSendObjectToClient(this.type, this.instance, this.typeId, clientToken);
    if (typeIdOrNothing === nothing) return null;

    return typeIdOrNothing;
  }

  reportPropertyChanged<TKey extends keyof TInstance & string>(propertyInfo: TrackedPropertyInfo<any, any>, key: TKey, value: TInstance[TKey]) {
    if (!this.checkCanTrackPropertyInfo(propertyInfo, this.instance, key)) return;

    let current = this._properties.get(key);
    if (!current) {
      current = {
        hasPendingChanges: true,
        value: undefined,
        propertyInfo,
        isBeeingApplied: false,
      };
      this._properties.set(key, current);
      this.hasPendingChanges = true;
    }
    if (current.value === value) return;

    this.clearAllStoredReferencesWithKey(key);

    current.value = value;
    if (current.isBeeingApplied) return;

    current.hasPendingChanges = true;
    this.hasPendingChanges = true;
  }

  clearStates(clientToken?: ClientToken) {
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

  private checkCanTrackPropertyInfo(propertyInfo: TrackedPropertyInfo<TInstance, any> | undefined, instance: TInstance, propertyKey: string) {
    if (!propertyInfo) {
      return false;
    }
    if (propertyInfo.canTrack?.call(instance, { instance, key: propertyKey as any }) === false) {
      return false;
    }
    return true;
  }

  override get dispatcher(): ISyncObjectDispatcher {
    return (this._dispatcher ??= this.createDispatcher());
  }

  private createDispatcher() {
    const result = {
      invoke: (clientOrClientsOrMethodName: OneOrMany<ClientToken> | string, ...args: any[]) => {
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
      },
    };
    return result as unknown as ISyncObjectDispatcher<TInstance>;
  }

  private invokeMethodForClients<TMethodName extends keyof TInstance & string>(
    clientOrClients: OneOrMany<ClientToken> | undefined,
    methodName: TMethodName,
    ...parameters: TInstance[TMethodName] extends (...a: infer P) => any ? P : never
  ): Map<ClientToken, Promise<MethodReturnType<TInstance, TMethodName>>> {
    const clients = clientOrClients ?? this._objectInfo.owner.registeredClientTokens;

    const methodInfo = this._typeInfo.trackedMethods.get(methodName);

    const resultByClient: Map<ClientToken, Promise<MethodReturnType<TInstance, TMethodName>>> = new Map();

    if (!this.checkCanTrackPropertyInfo(methodInfo, this.instance, methodName)) {
      forEachIterable(clients, (c) => {
        resultByClient.set(c, Promise.reject<MethodReturnType<TInstance, TMethodName>>(new Error(`Not allowed to invoke method ${methodName} on object ${this.objectId}.`)));
      });
      return resultByClient;
    }

    const id = this._nextInvokeId++;
    const promiseDataByClient: Map<ClientToken, InvokeMethodClientInfo> = new Map();

    const invokeMethodInfo: InvokeMethodInfo = {
      id,
      methodName: methodName as string,
      parameters,
      invokeMethodInfoByClient: promiseDataByClient,
    };

    forEachIterable(clients, (clientToken) => {
      let resolve: (value: any) => void;
      let reject: (reason: any) => void;
      const promise = new Promise<MethodReturnType<TInstance, TMethodName>>((res, rej) => {
        resolve = (data) => {
          res(this.deserializeValue(data, clientToken) as MethodReturnType<TInstance, TMethodName>);
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
        resolve: resolve!,
        reject: reject!,
        sentToClient: false,
      });
    });

    this._pendingInvokeMethodInfosById.set(invokeMethodInfo.id, invokeMethodInfo);
    this.reportPendingMessages();

    return resultByClient;
  }
}
