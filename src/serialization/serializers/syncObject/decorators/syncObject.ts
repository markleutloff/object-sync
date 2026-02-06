import { Constructor, ClientToken, ResolvablePropertyInfos } from "../../../../shared/index.js";
import type { ObjectSync } from "../../../../objectSync/objectSync.js";
import { TrackedMethodInfo, TrackedMethodSettings } from "./syncMethod.js";
import { TrackedPropertyInfo, TrackedPropertySettings } from "./syncProperty.js";
import { defaultSerializersOrTypes } from "../../base.js";
import { nothing } from "../types.js";

const TRACKABLE_CONSTRUCTOR_INFO = Symbol("trackableConstructor");

export const allSyncObjectTypes: Set<Constructor> = new Set();

export type TypeGenerator = Constructor | TrackableTargetGenerator;

export type TrackableTargetGenerator<T = any> = (client: ObjectSync, properties: ResolvablePropertyInfos<T>, objectId: string, typeId: string) => T;

type PossibleClientTypeResults = string | typeof nothing | Constructor | null;

export type TrackableConstructorInfo<T extends object> = {
  trackedProperties: Map<string, TrackedPropertyInfo<T, any>>;
  trackedMethods: Map<string, TrackedMethodInfo<T>>;
  typeId: string;

  /**
   * Function which is called before sending the object to the client, or a string typeId.
   * Can be used to modify or filter the typeId being sent.
   * When the "nothing" symbol, null or undefined is returned, the object creation will be skipped.
   */
  clientTypeId?: PossibleClientTypeResults | ((this: T, payload: ClientTypeIdFunctionPayload<T>) => PossibleClientTypeResults);

  /**
   * Optional ordered list of properties to use for the constructor arguments or a function that returns the constructor arguments for the object.
   * If provided, this will be used to serialize the constructor arguments when creating the object on the client.
   * If not provided, the default constructor will be used without arguments.
   * When a function is provided, it can also return an object with propertiesToOmit to exclude certain properties from being serialized for the creation message.
   */
  constructorArguments?:
    | string[]
    | ((
        this: T,
        payload: ConstructorArgumentsFunctionPayload<T>,
      ) =>
        | string[]
        | {
            propertiesToOmit?: string[];
            arguments: any[];
          });
};

export type ConstructorArgumentsFunctionPayload<T extends object> = ClientTypeIdFunctionPayload<T>;

export type ClientTypeIdFunctionPayload<T extends object> = {
  // The instance of the object which is being sent.
  instance: T;
  // The constructor function of the object being sent.
  constructor: Constructor<T>;
  // The current typeId of the object which will be send
  typeId: string;
  // The client token to which the object is being sent.
  destinationClientToken: ClientToken;
};

type TrackableObjectSettings<T extends object> = {
  // The type ID for the trackable object
  typeId?: string;

  // Additional settings for tracked properties
  properties?: { [propertyKey: string]: TrackedPropertySettings<T, any> };
  // Additional settings for tracked methods
  methods?: { [methodKey: string]: TrackedMethodSettings<T> };

  /**
   * Function which is called before sending the object to the client, or a string typeId.
   * Can be used to modify or filter the typeId being sent.
   * When the "nothing" symbol, null or undefined is returned, the object creation will be skipped.
   */
  clientTypeId?: PossibleClientTypeResults | ((this: T, payload: ClientTypeIdFunctionPayload<T>) => PossibleClientTypeResults);

  /**
   * Optional list of constructor argument names or a function that returns the constructor arguments for the object.
   * If provided, this will be used to serialize the constructor arguments when creating the object on the client.
   * If not provided, the default constructor will be used without arguments.
   * When a function is provided, it can also return an object with propertiesToOmit to exclude certain properties from being serialized for the creation message.
   */
  constructorArguments?:
    | string[]
    | ((
        this: T,
        payload: ConstructorArgumentsFunctionPayload<T>,
      ) =>
        | string[]
        | {
            propertiesToOmit?: string[];
            arguments: any[];
          });
};

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
    trackableInfo.clientTypeId = settings.clientTypeId;
    trackableInfo.constructorArguments = settings.constructorArguments;

    if (settings.properties) {
      for (const [propertyKey, propertySettings] of Object.entries(settings.properties)) {
        trackableInfo.trackedProperties.set(propertyKey, {
          ...propertySettings,
        });
      }
    }
    if (settings.methods) {
      for (const [methodKey, methodSettings] of Object.entries(settings.methods)) {
        trackableInfo.trackedMethods.set(methodKey, {
          ...methodSettings,
        });
      }
    }

    allSyncObjectTypes.add(target as any);

    defaultSerializersOrTypes.push(target as any);
  };
}

export function ensureTrackableConstructorInfo<T extends object = any>(metadata: DecoratorMetadataObject): TrackableConstructorInfo<T> {
  const oldTrackableInfo = (metadata[TRACKABLE_CONSTRUCTOR_INFO] ?? {
    trackedProperties: new Map<string, TrackedPropertyInfo<T, any>>(),
    trackedMethods: new Map<string, TrackedMethodInfo<T>>(),
    isAutoTrackable: false,
    clientTypeId: undefined,
  }) as TrackableConstructorInfo<T>;

  const newTrackableInfo: TrackableConstructorInfo<T> = {
    trackedProperties: new Map<string, TrackedPropertyInfo<T, any>>(oldTrackableInfo.trackedProperties),
    trackedMethods: new Map<string, TrackedMethodInfo<T>>(oldTrackableInfo.trackedMethods),
    typeId: oldTrackableInfo.typeId,
    clientTypeId: oldTrackableInfo.clientTypeId,
  };

  metadata![TRACKABLE_CONSTRUCTOR_INFO] = newTrackableInfo;

  return newTrackableInfo;
}

export function getTrackableTypeInfo<T extends object = any>(ctor: Constructor<T>): TrackableConstructorInfo<T> | null {
  const trackableInfo: TrackableConstructorInfo<T> | undefined = (ctor as any)[Symbol.metadata]?.[TRACKABLE_CONSTRUCTOR_INFO] as TrackableConstructorInfo<T>;
  return trackableInfo ?? null;
}

export function beforeSendObjectToClient(constructor: Constructor, instance: object, typeId: string, destinationClientToken: ClientToken) {
  const constructorInfo = getTrackableTypeInfo(constructor);
  if (!constructorInfo) {
    return nothing;
  }
  if (constructorInfo.clientTypeId === undefined) {
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
  const newConstructorInfo = getTrackableTypeInfo(constructorInfo.clientTypeId as any);
  if (newConstructorInfo && newConstructorInfo.typeId) {
    return newConstructorInfo.typeId;
  }

  const result = (constructorInfo.clientTypeId as any).call(instance, { instance, constructor, typeId, destinationClientToken });
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
