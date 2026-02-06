import { ClientToken, Constructor, CreateObjectMessage, Message } from "../shared/index.js";
import { ExtendedTypeSerializer } from "./extendedTypeSerializer.js";
import { getSerializerSymbol, TypeSerializerConstructor } from "./serializedTypes.js";
import { defaultSerializersOrTypes } from "./serializers/base.js";

type SimpleTypeSerializerSettings<TInstance extends object, TPayload = any> = {
  type: Constructor<TInstance>;
  typeId: string;
  serialize: (obj: TInstance) => TPayload;
  deserialize: (data: TPayload) => TInstance;
};

export function createSimpleTypeSerializerClass<TInstance extends object, TPayload = any>(settings: SimpleTypeSerializerSettings<TInstance, TPayload>): TypeSerializerConstructor {
  const { type, typeId, serialize, deserialize } = settings;

  const result = class SimpleTypeSerializer extends ExtendedTypeSerializer<TInstance> {
    static override canSerialize(instanceOrTypeId: object | string): boolean {
      if (typeof instanceOrTypeId === "string") {
        return instanceOrTypeId === typeId;
      } else {
        return instanceOrTypeId instanceof type;
      }
    }

    override getTypeId(clientToken: ClientToken): string {
      return typeId;
    }

    override generateMessages(clientToken: ClientToken, isNewClient: boolean): Message[] {
      if (isNewClient) return [this.createMessage("create", serialize(this.instance), clientToken)];
      return [];
    }

    onCreateMessageReceived(message: CreateObjectMessage, clientToken: ClientToken): void {
      this.instance = deserialize(message.data as TPayload);
    }
  };

  defaultSerializersOrTypes.push(result);

  // Add the getSerializer static property getter to the constructor type
  Object.defineProperty(type, getSerializerSymbol, {
    value: () => result,
    writable: true,
    configurable: false,
    enumerable: false,
  });

  return result;
}
