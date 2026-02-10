import { ClientToken, ChangeObjectMessage, CreateObjectMessage, Message } from "../shared/index.js";
import { ObjectInfo } from "./objectInfo.js";
import { SyncAgent } from "./syncAgent.js";

export abstract class ExtendedSyncAgent<TInstance extends object = object, TCreatePayload = any, TChangePayload = any> extends SyncAgent<TInstance, TCreatePayload, TChangePayload> {
  private readonly _messageTypeToHandler: Map<string, (message: Message, clientToken: ClientToken) => void> = new Map();
  private _isApplyingMessages: number = 0;

  constructor(objectInfo: ObjectInfo<TInstance>) {
    super(objectInfo);
    this.registerMessageHandler<CreateObjectMessage<TCreatePayload>>("create", (message, clientToken) => this.onCreateMessageReceived(message, clientToken));
    this.registerMessageHandler<ChangeObjectMessage<TChangePayload>>("change", (message, clientToken) => this.onChangeMessageReceived(message, clientToken));
  }

  protected get isApplyingMessages() {
    return this._isApplyingMessages > 0;
  }

  protected registerMessageHandler<TMessage extends Message>(messageType: string, handler: (message: TMessage, clientToken: ClientToken) => void) {
    this._messageTypeToHandler.set(messageType, handler as any);
  }

  override applyMessage(message: Message, clientToken: ClientToken) {
    this._isApplyingMessages++;
    try {
      const handler = this._messageTypeToHandler.get(message.type);
      if (handler) {
        return handler(message, clientToken);
      } else if (message.type === "create") {
        throw new Error(`No handler registered for message type '${message.type}' in serializer.`);
      }
    } finally {
      this._isApplyingMessages--;
    }
  }

  abstract onCreateMessageReceived(message: CreateObjectMessage<TCreatePayload>, clientToken: ClientToken): void;

  onChangeMessageReceived(message: ChangeObjectMessage<TChangePayload>, clientToken: ClientToken): void {
    // Default implementation does nothing
  }
}
