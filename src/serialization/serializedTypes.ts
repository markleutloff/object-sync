import { TypeSerializer } from "./typeSerializer.js";
import { ObjectInfo } from "./objectInfo.js";

export const getSerializerSymbol = Symbol("getSerializer");

export type TypeSerializerConstructor<TTypeSerializer extends TypeSerializer = TypeSerializer, TInstance extends object = any> = {
  new (objectInfo: ObjectInfo<TInstance>): TTypeSerializer;

  canSerialize(instanceOrTypeId: object | string): boolean;
};
