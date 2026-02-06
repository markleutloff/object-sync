import { TypeSerializerConstructor } from "../serialization/index.js";
import { Message, Constructor } from "../shared/index.js";
import { ObjectSync } from "./objectSync.js";
import { ObjectIdGeneratorSettings } from "./types.js";

export type StandaloneSerializationSettings = {
  /**
   * Identity of the internal ObjectSync instance, defaults to "host".
   */
  identity?: string;

  /**
   * Identity of the internal client ObjectSync instance, defaults to "client".
   */
  clientIdentity?: string;

  /**
   * Type serializers to use for serializing and deserializing property values during synchronization.
   * Can either be provided as an array of type serializers or constructors of SyncObject types.
   * When constructors are provided, the corresponding internal TypeSerializer will be used.
   * When not provided, all registered types and serializers will be used.
   */
  serializers?: (TypeSerializerConstructor | Constructor)[];

  /**
   * Intrinsic type serializers to use for serializing and deserializing base types (Array, Map, Set, Object) during synchronization.
   * Can be provided as an array of type serializers.
   * When not provided, default intrinsic type serializers will be used.
   */
  intrinsicSerializers?: TypeSerializerConstructor[];

  /**
   * Settings for generating object IDs.
   * When not provided, a default generator with the identity as prefix will be used (eg: "host-1").
   */
  objectIdGeneratorSettings?: ObjectIdGeneratorSettings;
};

/**
 * Serializes the given value into a string that can be deserialized later using `deserializeValue`.
 * @param value - The object to serialize.
 * @param settings - Optional settings for serialization.
 * @returns The serialized string representation of the object.
 */
export function serializeValue(value: any, settings?: StandaloneSerializationSettings) {
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

/**
 * Deserializes the given string back into an object that was previously serialized using `serializeValue`.
 * @param data - The serialized string representation of the object.
 * @param settings - Optional settings for deserialization.
 * @returns The deserialized object.
 */
export function deserializeValue<TValue = any>(data: string, settings?: StandaloneSerializationSettings) {
  const hostSync = new ObjectSync({ ...settings, identity: settings?.clientIdentity ?? "client" });
  const clientToken = hostSync.registerClient({ identity: settings?.identity ?? "host" });
  const messages = JSON.parse(data) as Message[];
  hostSync.applyMessagesAsync(messages, clientToken);

  const root = hostSync.findOne("root");
  if (root) return root as TValue;
  const primitive = hostSync.findOne("value");
  if (primitive) return (primitive as any).value as TValue;
  throw new Error("Deserialized data does not contain a root or primitive value");
}
