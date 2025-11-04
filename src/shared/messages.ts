export const isPropertyInfoSymbol = Symbol("isPropertyInfo");

export type PropertyInfo<T extends object, TKey extends keyof T> = {
  value?: T[TKey];
  objectId?: unknown;
  [isPropertyInfoSymbol]?: true;
};

export type PropertyInfos<T extends object, TAdditionalPropertyInfo extends object = object> = { [K in keyof T]?: PropertyInfo<T, K> & TAdditionalPropertyInfo };
export type ResolvablePropertyInfos<T extends object> = {
  deleteProperty(key: keyof T & string): void;
  get deletedProperties(): (keyof T & string)[];
} & {
  [K in keyof T]?: T[K];
};

export type MessageBase = {
  type: string;
  objectId: unknown;
};

export type DeleteObjectMessage = MessageBase & { type: "delete" };

export type CreateObjectMessage<T extends object, TAdditionalPropertyInfo extends object = object> = MessageBase & {
  type: "create";
  typeId: string;
  properties: PropertyInfos<T, TAdditionalPropertyInfo>;
};

export type ChangeObjectMessage<T extends object, TAdditionalPropertyInfo extends object = object> = MessageBase & {
  type: "change";
  properties: PropertyInfos<T, TAdditionalPropertyInfo>;
};

export type ExecuteObjectMessage<T extends object> = MessageBase & {
  type: "execute";
  id: unknown;
  method: keyof T & string;
  parameters: PropertyInfo<any, any>[];
};

export type Message<T extends object = object, TAdditionalPropertyInfo extends object = object> =
  | DeleteObjectMessage
  | CreateObjectMessage<T, TAdditionalPropertyInfo>
  | ChangeObjectMessage<T, TAdditionalPropertyInfo>
  | ExecuteObjectMessage<T>;

export function isPropertyInfo(value: any): value is PropertyInfo<any, any> {
  return isPropertyInfoSymbol in value;
}

export type MethodExecuteResult = {
  id: unknown;
  objectId: unknown;
  result: any;
  status: "resolved" | "rejected" | "sync";
  error: any;
};
