import { ChangeObjectMessage, CreateObjectMessage, Message } from "../../shared/messages.js";
import { ExtendedTypeSerializer } from "../serializer.js";
import { defaultIntrinsicSerializers } from "./base.js";
import { ObjectInfo } from "../../shared/objectInfo.js";
import { ClientToken } from "../../shared/clientToken.js";

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

  constructor(objectInfo: ObjectInfo<TInstance>) {
    super(objectInfo);

    if (objectInfo.instance) {
      for (const key of Object.keys(objectInfo.instance)) {
        const value = (objectInfo.instance as any)[key];
        this.storeReference(value);
      }
    }
  }

  getTypeId(clientToken: ClientToken) {
    return TYPE_ID;
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

  generateMessages(clientToken: ClientToken, isNewClientConnection: boolean): Message[] {
    if (!isNewClientConnection && !this.hasPendingChanges) return [];

    const message: CreateObjectMessage<TPayload> | ChangeObjectMessage<TPayload> = {
      type: isNewClientConnection ? "create" : "change",
      objectId: this.objectId,
      typeId: (isNewClientConnection ? TYPE_ID : undefined) as any,
      data: this.getSerializedData(clientToken),
    };
    return [message];
  }

  private getSerializedData(clientToken: ClientToken) {
    this.clearAllStoredReferencesWithClientConnection(clientToken);

    const data: Record<string, any> = {};
    for (const key of Object.keys(this.instance)) {
      const value = (this.instance as any)[key];
      this.storeReference(value, key, clientToken);
      const mappedValue = this.serializeValue(value, clientToken);
      data[key] = mappedValue;
    }
    return data;
  }
}

defaultIntrinsicSerializers.push(ObjectSerializer);
