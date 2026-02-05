import { CreateObjectMessage, Message } from "../../shared/messages.js";
import { ExtendedTypeSerializer } from "../serializer.js";
import { defaultIntrinsicSerializers } from "./base.js";
import { ClientToken } from "../../shared/clientToken.js";
import { SerializedValue } from "../serializedTypes.js";

type TInstance = Error;
type TCreatePayload = {
  message: string;
  name: string;
  stack?: string;
  type: string;
  cause?: SerializedValue;
  errors?: SerializedValue[];
};

const TYPE_ID = "<error>";

export class ErrorSerializer extends ExtendedTypeSerializer<TInstance, TCreatePayload> {
  static canSerialize(instanceOrTypeId: object | string): boolean {
    if (typeof instanceOrTypeId === "string") {
      return instanceOrTypeId === TYPE_ID;
    }
    return instanceOrTypeId instanceof Error;
  }

  getTypeId(clientToken: ClientToken) {
    return TYPE_ID;
  }

  onCreateMessageReceived(message: CreateObjectMessage<TCreatePayload>, clientToken: ClientToken): void {
    switch (message.data.type) {
      case "EvalError":
        this.instance = new EvalError(message.data.message);
        break;
      case "RangeError":
        this.instance = new RangeError(message.data.message);
        break;
      case "ReferenceError":
        this.instance = new ReferenceError(message.data.message);
        break;
      case "SyntaxError":
        this.instance = new SyntaxError(message.data.message);
        break;
      case "TypeError":
        this.instance = new TypeError(message.data.message);
        break;
      case "URIError":
        this.instance = new URIError(message.data.message);
        break;
      case "AggregateError":
        this.instance = new AggregateError([], message.data.message);
        break;
      default:
        this.instance = new Error(message.data.message);
        if (this.instance.name !== message.data.name) this.instance.name = message.data.name;
        break;
    }
    if (message.data.errors) {
      message.data.errors.forEach((serializedValue) => {
        const deserializedError = this.deserializeValue(serializedValue, clientToken) as Error;
        (this.instance as AggregateError).errors.push(deserializedError);
      });
    }
    if (message.data.stack) this.instance.stack = message.data.stack;
    if (message.data.cause) this.instance.cause = this.deserializeValue(message.data.cause, clientToken) as Error;
  }

  generateMessages(clientToken: ClientToken, isNewClient: boolean): Message[] {
    if (!isNewClient && !this.hasPendingChanges) return [];

    if (isNewClient) {
      const message: CreateObjectMessage<TCreatePayload> = {
        type: "create",
        objectId: this.objectId,
        typeId: this.getTypeId(clientToken)!,
        data: this.getCreationData(clientToken),
      };
      return [message];
    }
    return [];
  }

  private getCreationData(clientToken: ClientToken) {
    return {
      message: this.instance.message.toString(),
      name: this.instance.name.toString(),
      stack: this.instance.stack?.toString(),
      type: this.instance.constructor.name.toString(),
      errors: this.instance instanceof AggregateError ? this.instance.errors.filter((e) => e instanceof Error).map((e) => this.serializeValue(e, clientToken)) : undefined,
      cause: this.instance.cause instanceof Error ? this.serializeValue(this.instance.cause, clientToken) : undefined,
    };
  }
}

defaultIntrinsicSerializers.push(ErrorSerializer);
