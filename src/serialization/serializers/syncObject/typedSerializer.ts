import { Constructor } from "../../../shared/index.js";
import { getTrackableTypeInfo } from "./decorators/syncObject.js";
import { SyncObjectSerializer } from "./serializer.js";
import { TypeSerializerConstructor } from "../../serializedTypes.js";
import { ObjectInfo } from "../../objectInfo.js";

const serializersByType: Map<Constructor, TypeSerializerConstructor<SyncObjectSerializer<any>>> = new Map();

export function getSyncObjectSerializer<TInstance extends object>(type: Constructor<TInstance>): TypeSerializerConstructor<SyncObjectSerializer<TInstance>> {
  if (serializersByType.has(type)) {
    return serializersByType.get(type)!;
  }

  const typeId = getTrackableTypeInfo(type)!.typeId;

  const TypedSyncObjectSerializer = class TypedSyncObjectSerializer extends SyncObjectSerializer<TInstance> {
    static canSerialize(instanceOrTypeId: object | string): boolean {
      if (typeof instanceOrTypeId === "string") {
        return instanceOrTypeId === typeId;
      }
      return instanceOrTypeId.constructor === type;
    }

    get type(): Constructor {
      return type;
    }

    constructor(objectInfo: ObjectInfo<TInstance>) {
      super(objectInfo, typeId);
    }
  };

  serializersByType.set(type, TypedSyncObjectSerializer);
  return TypedSyncObjectSerializer;
}
