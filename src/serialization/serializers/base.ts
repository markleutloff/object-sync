import { ObjectInfo } from "../../shared/objectInfo.js";
import { Constructor, AbstractConstructor } from "../../shared/types.js";
import { getSerializerSymbol, TypeSerializerConstructor } from "../serializedTypes.js";
import { ExtendedTypeSerializer } from "../serializer.js";

export const defaultIntrinsicSerializers: TypeSerializerConstructor[] = [];
export const defaultSerializersOrTypes: (TypeSerializerConstructor | Constructor)[] = [];

export function createSerializerClass<TTypeSerializer extends ExtendedTypeSerializer<any>>(
  baseClass: AbstractConstructor<TTypeSerializer>,
  constructor: Constructor,
  typeId: string,
  isInstrinsic: boolean,
): TypeSerializerConstructor {
  const result = class TypedMapSerializer extends (baseClass as any) {
    static canSerialize(instanceOrTypeId: object | string): boolean {
      if (typeof instanceOrTypeId === "string") {
        return instanceOrTypeId === typeId;
      }

      return instanceOrTypeId instanceof constructor;
    }

    constructor(objectInfo: ObjectInfo) {
      super(constructor, typeId, objectInfo);
    }
  } as TypeSerializerConstructor;

  if (isInstrinsic) {
    defaultIntrinsicSerializers.push(result);
  } else {
    defaultSerializersOrTypes.push(result);
    // Add the getSerializer static property getter to the constructor type
    Object.defineProperty(constructor, getSerializerSymbol, {
      value: () => result,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  }
  return result;
}
