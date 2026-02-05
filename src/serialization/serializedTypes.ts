import { ObjectInfo } from "../shared/objectInfo.js";
import { ClientToken } from "../shared/clientToken.js";
import { TypeSerializer } from "./serializer.js";

export type PrimitiveValue = {
  value: string | number | boolean | null | undefined;
};

export type ObjectReference = {
  objectId: string;
  typeId: string;
};

export type SerializedValue = PrimitiveValue | ObjectReference | undefined;

export const getSerializerSymbol = Symbol("getSerializer");

export type TypeSerializerConstructor<TTypeSerializer extends TypeSerializer = TypeSerializer, TInstance extends object = any> = {
  new (objectInfo: ObjectInfo<TInstance>): TTypeSerializer;

  canSerialize(instanceOrTypeId: object | string): boolean;
};
