import "../shared/decorators.js";
import { allTypeGenerators, TrackableTargetGenerator } from "../applicator/applicator.js";
import { getObjectSyncMetaInfo } from "../shared/objectSyncMetaInfo.js";
import type { Constructor } from "../shared/types.js";
import type { ClientConnection } from "./tracker.js";
import type { ChangeTrackerObjectInfo } from "./trackerObjectInfo.js";

const TRACKABLE_CONSTRUCTOR_INFO = Symbol("trackableConstructor");

export type CanTrackPayload<T extends object, TKey extends keyof T & string> = {
  // The instance of the object which contains the property/method.
  instance: T;
  // The name of the property/method which should be tracked.
  key: TKey;
  // The ChangeTrackerObjectInfo which tracks the property/method.
  info: ChangeTrackerObjectInfo<T>;
};

export type CanApplyPayload<T extends object, TKey extends keyof T & string> = {
  // The instance of the object which contains the property/method.
  instance: T;
  // The name of the property/method which should be applied.
  key: TKey;
  // The clientConnection from which the changes came from.
  sourceClientConnection: ClientConnection;
};

type TrackedPropertySettingsBase<T extends object> = {
  /**
   * Returns true when the property/method should be tracked.
   */
  canTrack?<TKey extends keyof T & string>(this: T, payload: CanTrackPayload<T, TKey>): boolean;

  /**
   *  Returns true when the property/method change should be applied.
   */
  canApply?<TKey extends keyof T & string>(this: T, payload: CanApplyPayload<T, TKey>): boolean;

  /**
   * Defines how the property/method should be tracked/applied.
   * - "trackAndApply": Changes to the property/method are tracked and applied (thats the default).
   * - "trackOnly": Changes to the property/method are only tracked, not applied.
   * - "applyOnly": Changes to the property/method are only applied, not tracked.
   * - "none": Changes to the property/method are neither tracked nor applied.
   */
  mode?: "trackAndApply" | "trackOnly" | "applyOnly" | "none";
};

export type BeforeSendToClientPayload<T extends object, TKey extends keyof T & string, TValue> = {
  // The instance of the object which contains the property.
  instance: T;
  // The name of the property which is being sent.
  key: TKey;
  // The current value of the property.
  value: TValue;
  // The client connection to which the value is being sent.
  destinationClientConnection: ClientConnection;
};

type TrackedPropertySettings<T extends object, TValue> = TrackedPropertySettingsBase<T> & {
  /**
   * Function which is called before sending the property value to the client.
   * Can be used to modify or filter the value being sent.
   * When the symbol value "nothing" is returned, the property update will be skipped.
   */
  beforeSendToClient?<TKey extends keyof T & string>(this: T, payload: BeforeSendToClientPayload<T, TKey, TValue>): TValue | typeof nothing;
};

/**
 * A unique symbol used to indicate that no value should be sent or processed.
 */
export const nothing = Symbol("nothing");

export type BeforeExecuteOnClientPayload<T extends object, TKey extends keyof T & string> = {
  // The instance of the object which contains the method.
  instance: T;
  // The name of the method which is being sent
  key: TKey;
  // The arguments being passed to the method. These can be modified.
  args: T[TKey] extends (...args: infer P) => any ? P : never;
  // The client connection to which the method execution is being sent.
  destinationClientConnection: ClientConnection;
};

type TrackedMethodSettings<T extends object> = TrackedPropertySettingsBase<T> & {
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

type TrackedPropertyInfo<T extends object, TValue> = TrackedPropertySettings<T, TValue> & {
  isBeeingApplied: boolean;
};

type TrackedMethodInfo<T extends object> = TrackedMethodSettings<T> & {
  isBeeingApplied: boolean;
};

export type BeforeSendTypeToClientPayload<T extends object> = {
  // The instance of the object which is being sent.
  instance: T;
  // The constructor function of the object being sent.
  constructor: Constructor<T>;
  // The current typeId of the object which will be send
  typeId: string;
  // The client connection to which the object is being sent.
  destinationClientConnection: ClientConnection;
};

type TrackableConstructorInfo<T extends object> = {
  trackedProperties: Map<string, TrackedPropertyInfo<T, any>>;
  trackedMethods: Map<string, TrackedMethodInfo<T>>;
  typeId: string;

  /**
   * Function which is called before sending the object to the client.
   * Can be used to modify or filter the typeId being sent.
   * When the "nothing" symbol, null or undefined is returned, the object creation will be skipped.
   */
  beforeSendToClient?(this: T, payload: BeforeSendTypeToClientPayload<T>): string | typeof nothing | Constructor | null | undefined;
};

type TrackableObjectSettings<T extends object> = {
  // The type ID for the trackable object
  typeId?: string;
  // The generator function for creating trackable instances, when not provided the default constructor will be used
  generator?: TrackableTargetGenerator<T>;

  // Additional settings for tracked properties
  properties?: { [propertyKey: string]: TrackedPropertySettings<T, any> };
  // Additional settings for tracked methods
  methods?: { [methodKey: string]: TrackedMethodSettings<T> };

  /**
   * Function which is called before sending the object to the client.
   * Can be used to modify or filter the typeId being sent.
   * When the "nothing" symbol, null or undefined is returned, the object creation will be skipped.
   */
  beforeSendToClient?(this: T, payload: BeforeSendTypeToClientPayload<T>): string | typeof nothing | Constructor | null | undefined;
};

/**
 * Property accessor decorator for marking a property as trackable.
 * Registers the property and ensures changes are propagated to all TrackableObject instances.
 */
export function syncProperty<This extends object, Return>(settings?: TrackedPropertySettings<This, Return>) {
  settings ??= {};

  return function syncProperty(target: ClassAccessorDecoratorTarget<This, Return>, context: ClassAccessorDecoratorContext<This, Return>) {
    const trackableInfo = ensureTrackableConstructorInfo(context.metadata);
    const propertyInfo: TrackedPropertyInfo<This, Return> = {
      ...settings,
      isBeeingApplied: false,
    };

    const propertyName = context.name as string;
    trackableInfo.trackedProperties.set(propertyName, propertyInfo);

    const result: ClassAccessorDecoratorResult<This, Return> = {
      set(value: any) {
        const isBeeingApplied = propertyInfo.isBeeingApplied;
        propertyInfo.isBeeingApplied = false;

        target.set.call(this, value);

        if (isBeeingApplied || propertyInfo.mode === "none" || propertyInfo.mode === "applyOnly") return;

        const host = getObjectSyncMetaInfo(this as any)?.host;

        if (host && checkCanTrackPropertyInfo(propertyInfo, this as any, propertyName, host)) {
          host.onPropertyChanged(context.name as any, value);
        }
      },
    };
    return result;
  };
}

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
      isBeeingApplied: false,
    };
    const methodName = context.name as string;
    trackableInfo.trackedMethods.set(methodName, methodInfo);

    const originalMethod = target;
    const func = function (this: any, ...args: any[]) {
      const isBeeingApplied = methodInfo.isBeeingApplied;
      methodInfo.isBeeingApplied = false;

      const result = originalMethod.apply(this, args);

      if (isBeeingApplied || methodInfo.mode === "none" || methodInfo.mode === "applyOnly") return result;

      const hostInfo = getObjectSyncMetaInfo(this)?.host;
      if (hostInfo && checkCanTrackPropertyInfo(methodInfo, this, methodName, hostInfo)) {
        hostInfo.onMethodExecute(context.name as any, args);
      }

      return result;
    };
    return func;
  };
}

/**
 * Retrieves the TrackableConstructorInfo metadata for a class constructor, if present.
 */
export function getTrackableTypeInfo(ctor: Constructor): TrackableConstructorInfo<any> | null {
  const trackableInfo: TrackableConstructorInfo<any> | undefined = (ctor as any)[Symbol.metadata]?.[TRACKABLE_CONSTRUCTOR_INFO] as TrackableConstructorInfo<any>;
  return trackableInfo ?? null;
}

/**
 * Class decorator for marking a class as auto-trackable by the host.
 * Can be used as @syncObject or @syncObject("typeId").
 * Registers the class for automatic tracking and assigns a typeId if provided.
 */
export function syncObject<This extends abstract new (...args: any) => any>(settings?: TrackableObjectSettings<InstanceType<This>>) {
  return function syncObject(target: This, context: ClassDecoratorContext<This>) {
    settings ??= {};
    settings.typeId ??= context.name!;
    const trackableInfo = ensureTrackableConstructorInfo<InstanceType<This>>(context.metadata);
    trackableInfo.typeId = settings.typeId;
    trackableInfo.beforeSendToClient = settings.beforeSendToClient;

    if (settings.properties) {
      for (const [propertyKey, propertySettings] of Object.entries(settings.properties)) {
        trackableInfo.trackedProperties.set(propertyKey, {
          ...propertySettings,
          isBeeingApplied: false,
        });
      }
    }
    if (settings.methods) {
      for (const [methodKey, methodSettings] of Object.entries(settings.methods)) {
        trackableInfo.trackedMethods.set(methodKey, {
          ...methodSettings,
          isBeeingApplied: false,
        });
      }
    }

    allTypeGenerators.set(settings.typeId, settings.generator ?? (target as any));
  };
}

function ensureTrackableConstructorInfo<T extends object = any>(metadata: DecoratorMetadataObject): TrackableConstructorInfo<T> {
  const oldTrackableInfo = (metadata[TRACKABLE_CONSTRUCTOR_INFO] ?? {
    trackedProperties: new Map<string, TrackedPropertyInfo<T, any>>(),
    trackedMethods: new Map<string, TrackedMethodInfo<T>>(),
    isAutoTrackable: false,
    beforeSendToClient: undefined,
  }) as TrackableConstructorInfo<T>;

  const newTrackableInfo: TrackableConstructorInfo<T> = {
    trackedProperties: new Map<string, TrackedPropertyInfo<T, any>>(oldTrackableInfo.trackedProperties),
    trackedMethods: new Map<string, TrackedMethodInfo<T>>(oldTrackableInfo.trackedMethods),
    typeId: oldTrackableInfo.typeId,
    beforeSendToClient: oldTrackableInfo.beforeSendToClient,
  };

  metadata![TRACKABLE_CONSTRUCTOR_INFO] = newTrackableInfo;

  return newTrackableInfo;
}

export function getSyncPropertyInfo(constructor: Constructor, propertyKey: string) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return null;
  }
  const propertyInfo = constructorInfo.trackedProperties.get(propertyKey);
  return propertyInfo ?? null;
}

export function getSyncMethodInfo(constructor: Constructor, propertyKey: string) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return null;
  }
  const propertyInfo = constructorInfo.trackedMethods.get(propertyKey);
  return propertyInfo ?? null;
}

export function checkCanApplyProperty(constructor: Constructor, instance: object, propertyKey: string, isMethod: boolean, sourceClientConnection: ClientConnection) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) return false;
  const propertyInfo = isMethod ? constructorInfo.trackedMethods.get(propertyKey) : constructorInfo.trackedProperties.get(propertyKey);
  if (!propertyInfo) return false;

  if (propertyInfo.mode === "none" || propertyInfo.mode === "trackOnly") return;
  if (propertyInfo.canApply?.call(instance, { instance, key: propertyKey, sourceClientConnection }) === false) return false;
  return true;
}

export function checkCanTrackProperty(constructor: Constructor, instance: object, propertyKey: string, isMethod: boolean, info: ChangeTrackerObjectInfo<any>) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return false;
  }
  const propertyInfo = isMethod ? constructorInfo.trackedMethods.get(propertyKey) : constructorInfo.trackedProperties.get(propertyKey);
  return checkCanTrackPropertyInfo(propertyInfo, instance, propertyKey, info);
}

function checkCanTrackPropertyInfo(propertyInfo: TrackedPropertyInfo<any, any> | undefined, instance: object, propertyKey: string, info: ChangeTrackerObjectInfo<any>) {
  if (!propertyInfo) {
    return false;
  }
  if (propertyInfo.canTrack?.call(instance, { instance, key: propertyKey, info }) === false) {
    return false;
  }
  return true;
}

export function beforeExecuteOnClient(constructor: Constructor, instance: object, methodKey: string, args: any[], destinationClientConnection: ClientConnection) {
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

export function beforeSendPropertyToClient(constructor: Constructor, instance: object, propertyKey: string, value: any, destinationClientConnection: ClientConnection) {
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

export function beforeSendObjectToClient(constructor: Constructor, instance: object, typeId: string, destinationClientConnection: ClientConnection) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return nothing;
  }
  if (!constructorInfo.beforeSendToClient) {
    return typeId;
  }
  const result = constructorInfo.beforeSendToClient.call(instance, { instance, constructor, typeId, destinationClientConnection });
  if (result === null || result === undefined || result === nothing) {
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
