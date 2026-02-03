import { ChangeObjectMessage, CreateObjectMessage, Message } from "../../shared/messages.js";
import { ExtendedTypeSerializer } from "../serializer.js";
import { defaultIntrinsicSerializers } from "./base.js";
import { ObjectInfo } from "../../shared/objectInfo.js";
import { ClientToken } from "../../shared/clientToken.js";

type TInstance = Map<any, any>;
type TPayload = {
  key: any;
  value: any;
}[];
const TYPE_ID = "<map>";

export class MapSerializer extends ExtendedTypeSerializer<TInstance, TPayload> {
  static canSerialize(instanceOrTypeId: object | string): boolean {
    if (typeof instanceOrTypeId === "string") {
      return instanceOrTypeId === TYPE_ID;
    }
    return instanceOrTypeId instanceof Map;
  }

  constructor(objectInfo: ObjectInfo<TInstance>) {
    super(objectInfo);

    if (objectInfo.instance) {
      objectInfo.instance.forEach((value) => this.storeReference(value));
    }
  }

  getTypeId(clientToken: ClientToken) {
    return TYPE_ID;
  }

  onCreateMessageReceived(message: CreateObjectMessage<TPayload>, clientToken: ClientToken): void {
    this.instance = new Map();
    this.onChangeMessageReceived(message as unknown as ChangeObjectMessage<TPayload>, clientToken);
  }

  override onChangeMessageReceived(message: ChangeObjectMessage<TPayload>, clientToken: ClientToken): void {
    this.instance.clear();
    for (const value of message.data) {
      this.instance.set(this.deserializeValue(value.key, clientToken), this.deserializeValue(value.value, clientToken));
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

    const data: TPayload = [];
    let index = 0;
    for (const [key, value] of this.instance) {
      this.storeReference(key, `key:${index}`, clientToken);
      this.storeReference(value, `value:${index}`, clientToken);
      index++;

      const serializedKey = this.serializeValue(key, clientToken);
      const serializedValue = this.serializeValue(value, clientToken);
      data.push({ key: serializedKey, value: serializedValue });
    }
    return data;
  }
}

defaultIntrinsicSerializers.push(MapSerializer);
