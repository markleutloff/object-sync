import "../shared/decorators.js";
import { Constructor } from "../shared/types.js";
import { ClientToken } from "../shared/clientToken.js";
import { getObjectSyncMetaInfo } from "./base.js";
import { ensureTrackableConstructorInfo, getTrackableTypeInfo } from "./syncObject.js";
import { TrackedPropertySettingsBase } from "./syncProperty.js";

export type BeforeExecuteOnClientPayload<T extends object, TKey extends keyof T & string> = {
  // The instance of the object which contains the method.
  instance: T;
  // The name of the method which is being sent
  key: TKey;
  // The arguments being passed to the method. These can be modified.
  args: T[TKey] extends (...args: infer P) => any ? P : never;
  // The client connection to which the method execution is being sent.
  destinationClientToken: ClientToken;
};

export type TrackedMethodSettings<T extends object> = TrackedPropertySettingsBase<T> & {
  /**
   * Defines how method execution should handle returned Promises.
   * - "await": The method call will be awaited, and the resolved value will be used or the rejection will be sent back to the client.
   * - "normal": The Promise will be returned as-is without awaiting, once settled the result will be sent back to the client.
   * If not set, the default behavior is "normal".
   */
  promiseHandlingType?: "await" | "normal";

  /**
   * Function which is called before sending the method execution call to the client.
   * Can be used to prevent the method call from being sent.
   * When false is returned, the method call will be skipped.
   */
  beforeExecuteOnClient?<TKey extends keyof T & string>(this: T, payload: BeforeExecuteOnClientPayload<T, TKey>): boolean;
};

export type TrackedMethodInfo<T extends object> = TrackedMethodSettings<T> & {};

/**
 * Method decorator for marking a method as trackable.
 * Ensures method calls are recorded for all TrackableObject instances.
 */
export function syncMethod<This extends object, Return>(settings?: TrackedMethodSettings<This>) {
  settings ??= {};

  return function syncMethod(target: any, context: ClassMethodDecoratorContext) {
    const trackableInfo = ensureTrackableConstructorInfo(context.metadata);
    const methodInfo: TrackedMethodInfo<This> = {
      ...settings,
    };
    const methodName = context.name as string;
    trackableInfo.trackedMethods.set(methodName, methodInfo);

    /*const originalMethod = target;
    const func = function (this: any, ...args: any[]) {
      const result = originalMethod.apply(this, args);

      if (methodInfo.mode === "none" || methodInfo.mode === "applyOnly") return result;

      const metaInfo = getObjectSyncMetaInfo(this as any);
      metaInfo?.reportMethodInvoke(this as any, methodInfo, context.name as any, args);

      return result;
    };
    return func;*/
  };
}

export function beforeExecuteOnClient(constructor: Constructor, instance: object, methodKey: string, args: any[], destinationClientToken: ClientToken) {
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

export function getSyncMethodInfo(constructor: Constructor, propertyKey: string) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return null;
  }
  const propertyInfo = constructorInfo.trackedMethods.get(propertyKey);
  return propertyInfo ?? null;
}
