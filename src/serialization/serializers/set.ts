import { ChangeObjectMessage, CreateObjectMessage, Message } from "../../shared/messages.js";
import { ExtendedTypeSerializer } from "../serializer.js";
import { defaultIntrinsicSerializers } from "./base.js";
import { ObjectInfo } from "../../shared/objectInfo.js";
import { ClientToken } from "../../shared/clientToken.js";

type TInstance = Set<any>;
type TPayload = any[];
const TYPE_ID = "<set>";

export class SetSerializer extends ExtendedTypeSerializer<TInstance, TPayload> {
  static canSerialize(instanceOrTypeId: object | string): boolean {
    if (typeof instanceOrTypeId === "string") {
      return instanceOrTypeId === TYPE_ID;
    }
    return instanceOrTypeId instanceof Set;
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
    this.instance = new Set();
    this.onChangeMessageReceived(message as unknown as ChangeObjectMessage<TPayload>, clientToken);
  }

  override onChangeMessageReceived(message: ChangeObjectMessage<TPayload>, clientToken: ClientToken): void {
    this.instance.clear();
    for (const value of message.data) {
      this.instance.add(this.deserializeValue(value, clientToken));
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

    const data: any[] = [];
    let index = 0;
    this.instance.forEach((element) => {
      this.storeReference(element, index, clientToken);
      const mappedValue = this.serializeValue(element, clientToken);
      data.push(mappedValue);
      index++;
    });
    return data;
  }
}

defaultIntrinsicSerializers.push(SetSerializer);
