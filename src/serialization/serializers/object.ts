import { ChangeObjectMessage, CreateObjectMessage, Message, ClientToken } from "../../shared/index.js";
import { ExtendedTypeSerializer } from "../extendedTypeSerializer.js";
import { defaultIntrinsicSerializers } from "./base.js";
import { ObjectInfo } from "../objectInfo.js";

type TInstance = object;
type TPayload = object;
const TYPE_ID = "<object>";

export class ObjectSerializer extends ExtendedTypeSerializer<TInstance, TPayload> {
  static canSerialize(instanceOrTypeId: object | string): boolean {
    if (typeof instanceOrTypeId === "string") {
      return instanceOrTypeId === TYPE_ID;
    }
    return typeof instanceOrTypeId === "object";
  }

  override getTypeId(clientToken: ClientToken): string {
    return TYPE_ID;
  }

  override onInstanceSet(createdByCreateObjectMessage: boolean): void {
    super.onInstanceSet(createdByCreateObjectMessage);
  }

  onCreateMessageReceived(message: CreateObjectMessage<TPayload>, clientToken: ClientToken): void {
    this.instance = {};
    this.onChangeMessageReceived(message as unknown as ChangeObjectMessage<TPayload>, clientToken);
  }

  override onChangeMessageReceived(message: ChangeObjectMessage<TPayload>, clientToken: ClientToken): void {
    for (const key of Object.keys(message.data)) {
      (this.instance as any)[key] = this.deserializeValue((message.data as any)[key], clientToken);
    }
  }

  generateMessages(clientToken: ClientToken, isNewClient: boolean): Message[] {
    if (isNewClient) return [this.createMessage("create", this.getSerializedData(clientToken), clientToken)];
    else if (this.hasPendingChanges) return [this.createMessage("change", this.getSerializedData(clientToken))];
    return [];
  }

  private getSerializedData(clientToken: ClientToken) {
    this.clearStoredReferences(clientToken);

    const data: Record<string, any> = {};
    for (const key of Object.keys(this.instance)) {
      const value = (this.instance as any)[key];
      data[key] = this.serializeValue({ value, key, clientToken });
    }
    return data;
  }
}

defaultIntrinsicSerializers.push(ObjectSerializer);
