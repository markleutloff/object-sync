import { ChangeObjectMessage, CreateObjectMessage, Message } from "../shared/messages";
import { ObjectInfo, StoredReference } from "../shared/objectInfo.js";
import { Constructor, isPrimitiveValue } from "../shared/types.js";
import { ClientToken } from "../shared/clientToken.js";

export type TypeSerializerConstructor<TTypeSerializer extends TypeSerializer = TypeSerializer, TInstance extends object = any> = {
  new (objectInfo: ObjectInfo<TInstance>): TTypeSerializer;

  canSerialize(instanceOrTypeId: object | string): boolean;
};

export abstract class TypeSerializer<TInstance extends object = object> {
  static canSerialize(instanceOrTypeId: object | string): boolean {
    throw new Error("Not implemented");
  }

  private readonly _clients: Set<ClientToken> = new Set();
  private readonly _storedReferencesByKey: Map<number | string | symbol | undefined, Map<ClientToken | undefined, StoredReference>> = new Map();
  private _hasPendingChanges: boolean = false;

  constructor(protected readonly _objectInfo: ObjectInfo<TInstance>) {}

  protected get hasPendingChanges() {
    return this._hasPendingChanges;
  }

  protected set hasPendingChanges(value: boolean) {
    if (this._hasPendingChanges) return;
    this._hasPendingChanges = value;
    this.reportPendingMessages();
  }

  get objectId() {
    return this._objectInfo.objectId;
  }

  /**
   * The actual instance being serialized/deserialized.
   * Can be null when not yet created (eg: The serializer has been created for a new object but the create message has not yet been handled).
   * Must be set when the object is newly created (eg: when handling the create message).
   */
  get instance() {
    return this._objectInfo.instance;
  }
  set instance(value: TInstance) {
    this._objectInfo.instance = value;
    this.onInstanceSet(true);
  }

  onInstanceSet(createdByCreateObjectMessage: boolean): void {
    // When we are a newly tracked instance, we need to report pending messages (so that we may emit a create message)
    if (!createdByCreateObjectMessage) {
      this.reportPendingMessages();
    }
  }

  /**
   * The clients this serializer is tracking.
   */
  get clients() {
    return this._clients;
  }

  /**
   * Gets the type ID for the instance being serialized.
   * @param clientToken The client connection for which the type ID is requested. Can be used to return different type IDs based on the client.
   */
  abstract getTypeId(clientToken: ClientToken): string | null;

  /**
   * Called when a client connection is removed to allow the serializer to clean up any references related to the client connection.
   * @param clientToken The client connection being removed.
   */
  onClientConnectionRemoved(clientToken: ClientToken) {
    this._clients.delete(clientToken);

    this._storedReferencesByKey.forEach((storedReferencesByClient, key) => {
      const storedReference = storedReferencesByClient.get(clientToken);
      storedReference?.dispose();
    });
  }

  /**
   * Clears the states for the serializer.
   * @param clientToken Optional client connection for which to clear the state. If not provided, clears the state not related to any specific client connection.
   */
  clearStates(clientToken?: ClientToken): void {
    if (!clientToken) this._hasPendingChanges = false;
  }

  /**
   * Reports to the owner that there are pending messages for the object.
   * This will be implicitly called when setting hasPendingChanges to true. Or when the serializer is created with an existing instance.
   */
  protected reportPendingMessages(): void {
    this._objectInfo.owner.reportPendingMessagesForObject(this._objectInfo);
  }

  /**
   * Serializes a value (basically converts any reference values to ObjectReferences).
   */
  protected serializeValue(value: any, clientToken: ClientToken) {
    return this._objectInfo.owner.serializeValue(value, clientToken);
  }

  /**
   * Deserializes a value (basically converts any ObjectReferences to actual object references).
   */
  protected deserializeValue(value: any, clientToken: ClientToken) {
    return this._objectInfo.owner.deserializeValue(value, clientToken);
  }

  /**
   * Generates messages to be sent to the client connection.
   * @param clientToken The client connection for which to generate messages.
   * @param isNewClientConnection Whether the client connection is new (ie: just connected).
   * @returns An array of messages to be sent to the client connection.
   */
  abstract generateMessages(clientToken: ClientToken, isNewClientConnection: boolean): Message[];

  /**
   * Applies a message to the serializer.
   * Only create messages can never return a Promise.
   * Only create messages must be handled by the serializer. All other messages can be ignored if not supported.
   * @param message The message to apply.
   * @param clientToken The client connection from which the message was received.
   */
  abstract applyMessage(message: Message, clientToken: ClientToken): void | Promise<void>;

  /**
   * Stores a reference to an object which will be used to keep track of references for serialization purposes.
   * @param value The reference to store. When a primitive value is provided, no reference is stored but a dummy StoredReference is returned.
   * @returns A StoredReference which can be used to dispose the stored reference.
   */
  protected storeReference(value: any): StoredReference;

  /**
   * Stores a reference to an object which will be used to keep track of references for serialization purposes.
   * @param value The reference to store. When a primitive value is provided, no reference is stored but a dummy StoredReference is returned.
   * @param clientToken The client connection for which the reference is stored.
   * @returns A StoredReference which can be used to dispose the stored reference.
   */
  protected storeReference(value: any, clientToken: ClientToken): StoredReference;

  /**
   * Stores a reference to an object which will be used to keep track of references for serialization purposes.
   * @param value The reference to store. When a primitive value is provided, no reference is stored but a dummy StoredReference is returned.
   * @param key The key associated with the stored reference.
   * @returns A StoredReference which can be used to dispose the stored reference.
   */
  protected storeReference(value: any, key: number | string | symbol): StoredReference;
  /**
   * Stores a reference to an object which will be used to keep track of references for serialization purposes.
   * @param value The reference to store. When a primitive value is provided, no reference is stored but a dummy StoredReference is returned.
   * @param key The key associated with the stored reference.
   * @param clientToken The client connection for which the reference is stored.
   * @returns A StoredReference which can be used to dispose the stored reference.
   */
  protected storeReference(value: any, key: number | string | symbol, clientToken: ClientToken): StoredReference;

  protected storeReference(value: any, clientConnectionOrKey?: ClientToken | number | string | symbol, clientToken?: ClientToken): StoredReference {
    let key: number | string | symbol | undefined = undefined;
    if (clientConnectionOrKey && typeof clientConnectionOrKey === "object") {
      clientToken = clientConnectionOrKey as ClientToken;
    } else if (clientConnectionOrKey !== undefined) {
      key = clientConnectionOrKey;
    }

    return this.storeReferenceInternal(value, clientToken, key);
  }

  protected clearAllStoredReferencesWithKey(key: number | string | symbol): void {
    const storedReferencesByClient = this._storedReferencesByKey.get(key);
    if (storedReferencesByClient) {
      storedReferencesByClient.forEach((storedReference) => {
        storedReference.dispose();
      });
    }
  }

  protected clearAllStoredReferencesWithClientConnection(clientToken: ClientToken): void {
    this._storedReferencesByKey.forEach((storedReferencesByClient, key) => {
      const storedReference = storedReferencesByClient.get(clientToken);
      storedReference?.dispose();
    });
  }

  private storeReferenceInternal(value: any, clientToken: ClientToken | undefined, key: number | string | symbol | undefined): StoredReference {
    let storedReferencesByClient = this._storedReferencesByKey.get(key);
    if (!storedReferencesByClient) {
      storedReferencesByClient = new Map();
      this._storedReferencesByKey.set(key, storedReferencesByClient);
    }

    const previousStoredReference = storedReferencesByClient.get(clientToken);
    previousStoredReference?.dispose();

    if (isPrimitiveValue(value)) {
      return {
        dispose() {},
      };
    }

    const storedReference = this._objectInfo.owner.trackInternal(value)!.addReference(clientToken);

    let isDisposed = false;
    const finalStoredReference = {
      dispose: () => {
        if (isDisposed) return;
        isDisposed = true;
        storedReference.dispose();
        storedReferencesByClient.delete(clientToken);
        if (storedReferencesByClient.size === 0) {
          this._storedReferencesByKey.delete(key);
        }
      },
    };
    storedReferencesByClient.set(clientToken, finalStoredReference);
    return finalStoredReference;
  }

  get dispatcher(): any {
    return null;
  }
}

export abstract class ExtendedTypeSerializer<TInstance extends object = object, TPayload extends object = any> extends TypeSerializer<TInstance> {
  private readonly _messageTypeToHandler: Map<string, (message: Message, clientToken: ClientToken) => void | Promise<void>> = new Map();

  constructor(objectInfo: ObjectInfo<TInstance>) {
    super(objectInfo);
    this.registerMessageHandler<CreateObjectMessage<TPayload>>("create", (message, clientToken) => this.onCreateMessageReceived(message, clientToken));
    this.registerMessageHandler<ChangeObjectMessage<TPayload>>("change", (message, clientToken) => this.onChangeMessageReceived(message, clientToken));
  }

  protected registerMessageHandler<TMessage extends Message>(messageType: string, handler: (message: TMessage, clientToken: ClientToken) => void | Promise<void>) {
    this._messageTypeToHandler.set(messageType, handler as any);
  }

  override async applyMessage(message: Message, clientToken: ClientToken) {
    const handler = this._messageTypeToHandler.get(message.type);
    if (handler) {
      await handler(message, clientToken);
    } else if (message.type === "create") {
      throw new Error(`No handler registered for message type '${message.type}' in serializer.`);
    }
  }

  abstract onCreateMessageReceived(message: CreateObjectMessage<TPayload>, clientToken: ClientToken): void;

  onChangeMessageReceived(message: ChangeObjectMessage<TPayload>, clientToken: ClientToken): void {
    // Default implementation does nothing
  }
}

type SimpleTypeSerializerSettings<TInstance extends object, TPayload = any> = {
  type: Constructor<TInstance>;
  typeId: string;
  serialize: (obj: TInstance) => TPayload;
  deserialize: (data: TPayload) => TInstance;
};

export function MakeSimpleTypeSerializer<TInstance extends object, TPayload = any>(settings: SimpleTypeSerializerSettings<TInstance, TPayload>): TypeSerializerConstructor {
  const { type, typeId, serialize, deserialize } = settings;

  return class SimpleTypeSerializer extends ExtendedTypeSerializer<TInstance> {
    static override canSerialize(instanceOrTypeId: object | string): boolean {
      if (typeof instanceOrTypeId === "string") {
        return instanceOrTypeId === typeId;
      } else {
        return instanceOrTypeId instanceof type;
      }
    }

    override getTypeId(_clientConnection: ClientToken): string | null {
      return typeId;
    }

    override generateMessages(_clientConnection: ClientToken, isNewClientConnection: boolean): Message[] {
      const messages: Message[] = [];
      if (isNewClientConnection) {
        messages.push({
          type: "create",
          objectId: this.objectId,
          typeId: typeId,
          data: serialize(this.instance),
        } as CreateObjectMessage);
      }
      return messages;
    }

    onCreateMessageReceived(message: CreateObjectMessage, clientToken: ClientToken): void {
      this.instance = deserialize(message.data as TPayload);
    }
  };
}
