import { Message } from "../shared/index.js";
import { ObjectSync } from "./objectSync.js";
import { ObjectSyncSettings } from "./types.js";

export type StandaloneSerializationSettings = Pick<ObjectSyncSettings, "objectIdGeneratorSettings" | "intrinsics" | "types"> & {
  /**
   * Identity of the internal ObjectSync instance, defaults to "host".
   */
  identity?: string;

  /**
   * Identity of the internal client ObjectSync instance, defaults to "client".
   */
  clientIdentity?: string;
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
  const promises = hostSync.applyMessages(messages, clientToken);
  if (promises.length > 0) {
    throw new Error("Deserialization cannot be completed synchronously because there are pending promises.");
  }

  const root = hostSync.rootObjects.findOne("root");
  if (root) return root as TValue;
  const primitive = hostSync.rootObjects.findOne("value");
  if (primitive) return (primitive as any).value as TValue;
  throw new Error("Deserialized data does not contain a root or primitive value");
}
