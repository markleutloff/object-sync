import { get } from "http";
import { defaultConstructorsByTypeId, defaultGeneratorsByTypeId, TrackableTargetGenerator } from "../client/client.js";
import "../shared/decorators.js";
import { getHostObjectInfo, getObjectSyncMetaInfo } from "../shared/objectSyncMetaInfo.js";
import { hasInIterable, OneOrMany } from "../shared/types.js";

const TRACKABLE_CONSTRUCTOR_INFO = Symbol("trackableConstructor");

type Constructor<T = any> = { new (...args: any[]): T };

type TrackedPropertySettings = {
  designations?: string;
};

type TrackedMethodSettings = TrackedPropertySettings & {
  /*
   * Optional name of the method on the client side to map to, if different from the host side.
   * When not provided the same method name will be used.
   */
  clientMethod?: string;
};

type TrackableConstructorInfo = {
  trackedProperties: Map<string, TrackedPropertySettings>;
  trackedMethods: Map<string, TrackedMethodSettings>;
  isAutoTrackable: boolean;
  typeId?: string;
  designations?: OneOrMany<string>;
};

type TrackableObjectSettings<T extends object = any> = {
  // The type ID for the trackable object
  typeId?: string;
  // The generator function for creating trackable instances, when not provided the default constructor will be used
  generator?: TrackableTargetGenerator<T>;
  // Designations for controlling access to the object
  designations?: OneOrMany<string>;
  // Additional settings for tracked properties
  properties?: { [propertyKey: string]: TrackedPropertySettings };
  // Additional settings for tracked methods
  methods?: { [methodKey: string]: TrackedPropertySettings };
};

/**
 * Property accessor decorator for marking a property as trackable.
 * Registers the property and ensures changes are propagated to all TrackableObject instances.
 */
export function syncProperty<This, Return>(settings?: TrackedPropertySettings) {
  settings ??= {};

  return function syncProperty<This, Return>(target: ClassAccessorDecoratorTarget<This, Return>, context: ClassAccessorDecoratorContext<This, Return>) {
    const trackableInfo = ensureTrackableConstructorInfo(context.metadata);
    trackableInfo.trackedProperties.set(context.name as string, settings);

    const result: ClassAccessorDecoratorResult<This, Return> = {
      set(value: any) {
        target.set.call(this, value);

        const host = getHostObjectInfo(this as any);
        host?.onPropertyChanged(context.name as any, value);
      },
    };
    return result;
  };
}

/**
 * Method decorator for marking a method as trackable.
 * Ensures method calls are recorded for all TrackableObject instances.
 */
export function syncMethod<This, Return>(settings?: TrackedMethodSettings) {
  settings ??= {};

  return function syncMethod(target: any, context: ClassMethodDecoratorContext) {
    const trackableInfo = ensureTrackableConstructorInfo(context.metadata);
    trackableInfo.trackedMethods.set(context.name as string, settings);

    const originalMethod = target;
    return function (this: any, ...args: any[]) {
      const result = originalMethod.apply(this, args);

      const host = getObjectSyncMetaInfo(this)?.host;
      host?.onMethodExecute(settings.clientMethod ?? (context.name as any), args);

      return result;
    };
  };
}

/**
 * Retrieves the TrackableConstructorInfo metadata for a class constructor, if present.
 */
export function getTrackableTypeInfo(ctor: Constructor): TrackableConstructorInfo | null {
  const trackableInfo: TrackableConstructorInfo | undefined = (ctor as any)[Symbol.metadata]?.[TRACKABLE_CONSTRUCTOR_INFO] as TrackableConstructorInfo;
  return trackableInfo ?? null;
}

/**
 * Class decorator for marking a class as auto-trackable by the host.
 * Can be used as @syncObject or @syncObject("typeId").
 * Registers the class for automatic tracking and assigns a typeId if provided.
 */
export function syncObject<T extends object = any>(settings?: TrackableObjectSettings<T>): any {
  return function syncObject(target: T, context: ClassDecoratorContext) {
    settings ??= {};
    settings.typeId ??= context.name!;
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
      defaultConstructorsByTypeId.set(settings.typeId, target as any);
    }
  };
}

function ensureTrackableConstructorInfo(metadata: DecoratorMetadataObject): TrackableConstructorInfo {
  const oldTrackableInfo = (metadata[TRACKABLE_CONSTRUCTOR_INFO] ?? {
    trackedProperties: new Map<string, TrackedPropertySettings>(),
    trackedMethods: new Map<string, TrackedPropertySettings>(),
    isAutoTrackable: false,
  }) as TrackableConstructorInfo;

  const newTrackableInfo: TrackableConstructorInfo = {
    trackedProperties: new Map<string, TrackedPropertySettings>(oldTrackableInfo.trackedProperties),
    trackedMethods: new Map<string, TrackedPropertySettings>(oldTrackableInfo.trackedMethods),
    isAutoTrackable: oldTrackableInfo.isAutoTrackable,
    designations: oldTrackableInfo.designations,
    typeId: oldTrackableInfo.typeId,
  };

  metadata![TRACKABLE_CONSTRUCTOR_INFO] = newTrackableInfo;

  return newTrackableInfo;
}

export function checkCanUseProperty(constructor: Constructor, propertyKey: string, designation: string | undefined) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return false;
  }
  const propertyInfo = constructorInfo.trackedProperties.get(propertyKey);
  if (!propertyInfo) {
    return false;
  }

  if (propertyInfo.designations === undefined) return true;

  if (designation === undefined) return true;

  return hasInIterable(propertyInfo.designations, designation);
}

export function checkCanUseMethod(constructor: Constructor, propertyKey: string, designation: string | undefined) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return false;
  }
  const propertyInfo = constructorInfo.trackedMethods.get(propertyKey);
  if (!propertyInfo) {
    return false;
  }

  if (propertyInfo.designations === undefined) return true;

  if (designation === undefined) return true;

  return hasInIterable(propertyInfo.designations, designation);
}

export function checkCanUseObject(obj: object, designation: string | undefined) {
  return checkCanUseConstructor(obj.constructor as Constructor, designation);
}

export function checkCanUseConstructor(constructor: Constructor, designation: string | undefined) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return false;
  }

  if (constructorInfo.designations === undefined) return true;

  if (designation === undefined) return true;

  return hasInIterable(constructorInfo.designations, designation);
}
