import { getMetaInfo, ClientToken, Constructor } from "../../../../shared/index.js";
import { ensureTrackableConstructorInfo, getTrackableTypeInfo } from "./syncObject.js";
import { ObjectSyncMetaInfo } from "../metaInfo.js";
import { nothing } from "../types.js";
import type { ISyncAgent } from "../../../syncAgent.js";

export type CanTrackPayload<T extends object, TKey extends keyof T & string> = {
  // The instance of the object which contains the property/method.
  instance: T;
  // The name of the property/method which should be tracked.
  key: TKey;
  // The ChangeTrackerObjectInfo which tracks the property/method.
  //info: ChangeTrackerObjectInfo<T>;
};

export type CanApplyPayload<T extends object, TKey extends keyof T & string> = {
  // The instance of the object which contains the property/method.
  instance: T;
  // The name of the property/method which should be applied.
  key: TKey;
  // The clientToken from which the changes came from.
  sourceClientToken: ClientToken;
};

export type BeforeSendToClientPayload<T extends object, TKey extends keyof T & string, TValue> = {
  // The instance of the object which contains the property.
  instance: T;
  // The name of the property which is being sent.
  key: TKey;
  // The current value of the property.
  value: TValue;
  // The client connection to which the value is being sent.
  destinationClientToken: ClientToken;
};

export type AfterValueChangedPayload<T extends object, TKey extends keyof T & string, TValue> = {
  // The instance of the object which contains the property.
  instance: T;
  // The name of the property which was applied.
  key: TKey;
  // The new value of the property.
  value: TValue;
  // The client connection from which the value has been applied. Or null if the change was not caused by a client (e.g., when applying changes from the host itself).
  sourceClientToken: ClientToken | null;
  // The SyncAgent for the value (or null when the value is not a reference type).
  syncAgent: ISyncAgent | null;
};

export type TrackedPropertySettingsBase<T extends object> = {
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

export type TrackedPropertySettings<T extends object, TValue> = TrackedPropertySettingsBase<T> & {
  /**
   * Function which is called before sending the property value to the client.
   * Can be used to modify or filter the value being sent.
   * When the symbol value "nothing" is returned, the property update will be skipped.
   */
  beforeSendToClient?<TKey extends keyof T & string>(this: T, payload: BeforeSendToClientPayload<T, TKey, TValue>): TValue | typeof nothing;

  /**
   * List of allowed types which can be assigned from the sender.
   * When a value of a different type is assigned from the sender, the application will throw an error.
   * When not provided, all types are allowed.
   */
  allowedTypesFromSender?: Array<Constructor | null | undefined>;

  /**
   * Function which is called after the property value has been applied from a client.
   */
  afterValueChanged?<TKey extends keyof T & string>(this: T, payload: AfterValueChangedPayload<T, TKey, TValue>): void;
};

export type TrackedPropertyInfo<T extends object, TValue> = TrackedPropertySettings<T, TValue> & {};

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
    };

    const propertyName = context.name as string;
    trackableInfo.trackedProperties.set(propertyName, propertyInfo);

    const result: ClassAccessorDecoratorResult<This, Return> = {
      set(value: any) {
        target.set.call(this, value);

        if (propertyInfo.mode === "none" || propertyInfo.mode === "applyOnly") return;

        const metaInfo = getMetaInfo(this as any, ObjectSyncMetaInfo);
        metaInfo?.reportPropertyChanged(this as any, propertyInfo, propertyName, value);
      },
    };
    return result;
  };
}

export function checkCanApplyProperty(constructor: Constructor, instance: object, propertyKey: string, isMethod: boolean, sourceClientToken: ClientToken) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) return false;
  const propertyInfo = isMethod ? constructorInfo.trackedMethods.get(propertyKey) : constructorInfo.trackedProperties.get(propertyKey);
  if (!propertyInfo) return false;

  if (propertyInfo.mode === "none" || propertyInfo.mode === "trackOnly") return;
  if (propertyInfo.canApply?.call(instance, { instance, key: propertyKey, sourceClientToken }) === false) return false;
  return true;
}

export function beforeSendPropertyToClient(constructor: Constructor, instance: object, propertyKey: string, value: any, destinationClientToken: ClientToken) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return {
      skip: true,
    };
  }
  const propertyInfo = constructorInfo.trackedProperties.get(propertyKey);
  if (!propertyInfo) {
    return {
      skip: true,
    };
  }
  if (!propertyInfo.beforeSendToClient) {
    return {
      value,
    };
  }
  const result = propertyInfo.beforeSendToClient.call(instance, { instance, key: propertyKey, value, destinationClientToken });
  if (result === nothing) {
    return {
      skip: true,
    };
  }
  return {
    value: result,
  };
}

export function getSyncPropertyInfo(constructor: Constructor, propertyKey: string) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return null;
  }
  const propertyInfo = constructorInfo.trackedProperties.get(propertyKey);
  return propertyInfo ?? null;
}
