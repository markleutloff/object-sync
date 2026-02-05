import { getTrackableTypeInfo } from "../decorators/syncObject.js";
import { Constructor } from "../shared/types.js";
import { getSerializerSymbol, TypeSerializerConstructor } from "./serializedTypes.js";
import { getSyncObjectSerializer } from "./serializers/index.js";

export function getTypeSerializerClass(possibleSerializer: Constructor | TypeSerializerConstructor): TypeSerializerConstructor {
  if ("canSerialize" in possibleSerializer) {
    return possibleSerializer;
  }
  if (getSerializerSymbol in possibleSerializer) {
    return (possibleSerializer as any)[getSerializerSymbol]() as TypeSerializerConstructor;
  }
  const typeInfo = getTrackableTypeInfo(possibleSerializer);
  if (!typeInfo) {
    throw new Error(
      `Type '${possibleSerializer.name}' is not registered as a trackable type and not a TypeSerializer. Either decorate it with @syncObject, ensure that the type is a TypeSerializer or add the getSerializer symbol which returns the TypeSerializer for the provided type.`,
    );
  }

  return getSyncObjectSerializer(possibleSerializer);
}
