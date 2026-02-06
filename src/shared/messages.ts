import { SerializedValue } from "./serializedValue.js";

export const isPropertyInfoSymbol = Symbol("isPropertyInfo");

export type PropertyInfo<T extends object, TKey extends keyof T> = {
  value?: T[TKey];
  objectId?: string;
  typeId?: string;
  [isPropertyInfoSymbol]?: true;
};

export type PropertyInfos<T extends object, TAdditionalPropertyInfo extends object = object> = { [K in keyof T]?: PropertyInfo<T, K> & TAdditionalPropertyInfo };
export type ResolvablePropertyInfos<T> = {
  deleteProperty(key: keyof T & string): void;
  get deletedProperties(): (keyof T & string)[];
} & {
  [K in keyof T]?: T[K];
};

export const CreateMessageType = "create";
export const ChangeMessageType = "change";
export const DeleteMessageType = "delete";
export const ExecuteMessageType = "execute";
export const ExecuteFinishedMessageType = "executeFinished";

export type Message = {
  type: string;
  objectId: string;
};

export type CreateObjectMessage<TPayload = any> = Message & {
  type: typeof CreateMessageType;
  typeId: string;
  data: TPayload;
};

export type ChangeObjectMessage<TPayload = any> = Message & {
  type: typeof ChangeMessageType;
  data: TPayload;
};

export type DeleteObjectMessage = Message & {
  type: typeof DeleteMessageType;
};

export type ExecuteObjectMessage<TInstance extends object = any, TMethodName extends string & keyof TInstance = any> = Message & {
  type: typeof ExecuteMessageType;
  invokeId: unknown;
  method: TMethodName;
  parameters: SerializedValue[];
};

export type ExecuteFinishedObjectMessage = Message & {
  type: typeof ExecuteFinishedMessageType;
  invokeId: unknown;
  error?: any;
  result?: any;
};

export function isPropertyInfo(value: any): value is PropertyInfo<any, any> {
  return isPropertyInfoSymbol in value;
}

export type MethodExecuteResult = {
  invokeId: unknown;
  objectId: string;
} & (
  | {
      error: any;
    }
  | {
      result: any;
    }
);

export function isExecuteObjectMessage(message: Message): message is ExecuteObjectMessage {
  return isObjectMessage(message, ExecuteMessageType);
}

export function isChangeObjectMessage(message: Message): message is ChangeObjectMessage {
  return isObjectMessage(message, ChangeMessageType);
}

export function isCreateObjectMessage(message: Message): message is CreateObjectMessage {
  return isObjectMessage(message, CreateMessageType);
}

export function isDeleteObjectMessage(message: Message): message is DeleteObjectMessage {
  return isObjectMessage(message, DeleteMessageType);
}

export function isExecuteFinishedObjectMessage(message: Message): message is ExecuteFinishedObjectMessage {
  return isObjectMessage(message, ExecuteFinishedMessageType);
}

export function isObjectMessage<TMessage extends Message>(message: Message, type: string): message is TMessage {
  return message.type === type;
}
