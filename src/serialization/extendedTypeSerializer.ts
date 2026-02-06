import { ClientToken, ChangeObjectMessage, CreateObjectMessage, Message } from "../shared/index.js";
import { ObjectInfo } from "./objectInfo.js";
import { TypeSerializer } from "./typeSerializer.js";

export abstract class ExtendedTypeSerializer<TInstance extends object = object, TCreatePayload = any, TChangePayload = any> extends TypeSerializer<TInstance, TCreatePayload, TChangePayload> {
  private readonly _messageTypeToHandler: Map<string, (message: Message, clientToken: ClientToken) => void | Promise<void>> = new Map();

  constructor(objectInfo: ObjectInfo<TInstance>) {
    super(objectInfo);
    this.registerMessageHandler<CreateObjectMessage<TCreatePayload>>("create", (message, clientToken) => this.onCreateMessageReceived(message, clientToken));
    this.registerMessageHandler<ChangeObjectMessage<TChangePayload>>("change", (message, clientToken) => this.onChangeMessageReceived(message, clientToken));
  }

  protected registerMessageHandler<TMessage extends Message>(messageType: string, handler: (message: TMessage, clientToken: ClientToken) => void | Promise<void>) {
    this._messageTypeToHandler.set(messageType, handler as any);
  }

  override applyMessage(message: Message, clientToken: ClientToken) {
    const handler = this._messageTypeToHandler.get(message.type);
    if (handler) {
      return handler(message, clientToken);
    } else if (message.type === "create") {
      throw new Error(`No handler registered for message type '${message.type}' in serializer.`);
    }
  }

  abstract onCreateMessageReceived(message: CreateObjectMessage<TCreatePayload>, clientToken: ClientToken): void;

  onChangeMessageReceived(message: ChangeObjectMessage<TChangePayload>, clientToken: ClientToken): void {
    // Default implementation does nothing
  }
}
