import {
  SerializedValue,
  createDisposable,
  IDisposable,
  ClientToken,
  isPrimitiveValue,
  Message,
  CreateMessageType,
  CreateObjectMessage,
  ChangeMessageType,
  ChangeObjectMessage,
  isObjectMessage,
  Constructor,
  ClientTokenFilter,
  isForClientToken,
  toIterable,
} from "../shared/index.js";
import { ObjectInfo } from "./objectInfo.js";
import {
  MultipleSerializeAndReferenceStorageSettings,
  ReferenceStorageSettings,
  SerializeAndReferenceStorageSettingsBase,
  SingleSerializeAndReferenceStorageSettings,
} from "./referenceStorageSettings.js";

export type ISyncAgent<TInstance extends object = any> = {
  /**
   * The ID of the object being synchronized.
   */
  get objectId(): string;

  /**
   * The actual instance being synchronized.
   */
  get instance(): TInstance;

  /**
   * The clients for which this agent is tracking the object.
   */
  get clients(): Set<ClientToken>;

  /**
   * Gets or sets a client restriction filter.
   * With this you can remove an object from beeing tracked for a specific client or group of clients, or make it only tracked for a specific client or group of clients.
   */
  clientRestriction: ClientTokenFilter | null;
};

export abstract class SyncAgent<TInstance extends object = object, TCreatePayload = any, TChangePayload = any> implements ISyncAgent {
  private readonly _clients: Set<ClientToken> = new Set();
  private readonly _storedReferencesByKey: Map<number | string | symbol | undefined, Map<ClientToken | undefined, IDisposable>> = new Map();
  private _hasPendingChanges: boolean = false;
  private _clientFilters: ClientTokenFilter | null = null;

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
   * @param clientToken The client token for which the type ID is requested. Can be used to return different type IDs based on the client.
   */
  abstract getTypeId(clientToken: ClientToken): string | null;

  /**
   * Called when a client is removed to allow the serializer to clean up any references related to the client.
   * @param clientToken The client token being removed.
   */
  onClientUnregistered(clientToken: ClientToken) {
    this._clients.delete(clientToken);
    this.clearStoredReferences(clientToken);
  }

  /**
   * Clears the states for the serializer.
   * @param clientToken Optional client token for which to clear the state. If not provided, clears the state not related to any specific client.
   */
  clearStates(clientToken?: ClientToken): void {
    if (!clientToken) {
      this._hasPendingChanges = false;
    }
  }



  /**
   * Reports to the owner that there are pending messages for the object.
   * This will be implicitly called when setting hasPendingChanges to true. Or when the serializer is created with an existing instance.
   */
  protected reportPendingMessages(): void {
    this._objectInfo.owner.reportPendingMessagesForObject(this._objectInfo);
  }

  /**
   * Serializes a value.
   */
  protected serializeValue(value: any, clientToken: ClientToken): SerializedValue;

  /**
   * Serializes a value and stores a reference if it's an object (basically converts any reference values to ObjectReferences and stores a reference for them).
   * @param settings The settings for serializing and storing the reference.
   * @returns The serialized value.
   */
  protected serializeValue(settings: SingleSerializeAndReferenceStorageSettings): SerializedValue;

  /**
   * Serializes a list of values and stores a reference if it's an object (basically converts any reference values to ObjectReferences and stores a reference for them).
   * @param settings The settings for serializing and storing the reference.
   * @returns The serialized values.
   */
  protected serializeValue(settings: MultipleSerializeAndReferenceStorageSettings): SerializedValue[];

  protected serializeValue(valueOrSettings: any | SerializeAndReferenceStorageSettingsBase, clientToken?: ClientToken): SerializedValue | SerializedValue[] {
    if (!clientToken) {
      const settings = valueOrSettings as SerializeAndReferenceStorageSettingsBase;
      this.storeReference(settings as ReferenceStorageSettings);

      if ("value" in settings) {
        return this._objectInfo.owner.serializeValue((settings as SingleSerializeAndReferenceStorageSettings).value, settings.clientToken);
      } else {
        return (settings as MultipleSerializeAndReferenceStorageSettings).values.map((value) => this._objectInfo.owner.serializeValue(value, settings.clientToken));
      }
    }
    return this._objectInfo.owner.serializeValue(valueOrSettings, clientToken);
  }

  /**
   * Deserializes a value (basically converts any ObjectReferences to actual object references).
   */
  protected deserializeValue(value: SerializedValue, clientToken: ClientToken, allowedTypes?: (Constructor | undefined | null)[]) {
    return this._objectInfo.owner.deserializeValue(value, clientToken, allowedTypes);
  }

  /**
   * Generates messages to be sent to the client.
   * @param clientToken The client token for which to generate messages.
   * @param isNewClient Whether the client is new (ie: just connected).
   * @returns An array of messages to be sent to the client.
   */
  abstract generateMessages(clientToken: ClientToken, isNewClient: boolean): Message[];

  /**
   * Applies a message to the serializer.
   * Only create messages can never return a Promise.
   * Only create messages must be handled by the serializer. All other messages can be ignored if not supported.
   * @param message The message to apply.
   * @param clientToken The client token identifying the client from which the message was received.
   */
  abstract applyMessage(message: Message, clientToken: ClientToken): void | Promise<void>;

  /**
   * Stores a reference to an object which will be used to keep track of references for serialization purposes.
   * @param settings The settings for storing the reference.
   * @returns A StoredReference which can be used to dispose the stored reference.
   */
  protected storeReference(settings: ReferenceStorageSettings): IDisposable {
    let storedReferencesByClient = this._storedReferencesByKey.get(settings.key);
    if (!storedReferencesByClient) {
      storedReferencesByClient = new Map();
      this._storedReferencesByKey.set(settings.key, storedReferencesByClient);
    }

    const previousStoredReference = storedReferencesByClient.get(settings.clientToken);
    previousStoredReference?.dispose();

    const disposables: IDisposable[] = [];

    const values = "value" in settings ? [settings.value] : settings.values;

    for (const value of values) {
      if (isPrimitiveValue(value)) continue;

      const storedReference = this._objectInfo.owner.trackInternal(value)!.addReference(settings.clientToken);
      disposables.push(storedReference);
    }

    if (disposables.length === 0) {
      return createDisposable();
    }

    const finalStoredReference = createDisposable(() => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
      storedReferencesByClient.delete(settings.clientToken);
      if (storedReferencesByClient.size === 0) {
        this._storedReferencesByKey.delete(settings.key);
      }
    });
    storedReferencesByClient.set(settings.clientToken, finalStoredReference);
    return finalStoredReference;
  }

  /**
   * Clears the stored references for all keys of a specific client.
   * @param clientToken The client token for which to clear the stored references.
   */
  protected clearStoredReferences(clientToken: ClientToken): void;

  /**
   * Clears the stored references for a specific key of all clients.
   * @param key The key for which to clear the stored references.
   */
  protected clearStoredReferences(key: any): void;

  /**
   * Clears the stored references for a specific key and client.
   * @param key The key for which to clear the stored references.
   * @param clientToken The client token for which to clear the stored references.
   */
  protected clearStoredReferences(key: any, clientToken: ClientToken): void;

  protected clearStoredReferences(keyOrClientToken: any, clientToken?: ClientToken): void {
    if (keyOrClientToken instanceof ClientToken) {
      const clientToken = keyOrClientToken;
      this._storedReferencesByKey.forEach((storedReferencesByClient) => {
        const storedReference = storedReferencesByClient.get(clientToken);
        storedReference?.dispose();
      });
    } else {
      const key = keyOrClientToken;
      const storedReferencesByClient = this._storedReferencesByKey.get(key);
      if (storedReferencesByClient) {
        storedReferencesByClient.forEach((storedReference) => {
          if (!clientToken || storedReferencesByClient.has(clientToken)) {
            storedReference.dispose();
          }
        });
      }
    }
  }

  /**
   * Generates a create message for the instance being serialized, use this inside the generateMessages method when you want to generate a create message.
   * @param type - "create"
   * @param payload - The payload for the create message.
   * @param typeId - The type ID for the create message.
   * @returns A create message with the specified payload and type ID.
   */
  protected createMessage(type: "create", payload: TCreatePayload, typeId: string): CreateObjectMessage<TCreatePayload>;

  /**
   * Generates a create message for the instance being serialized, use this inside the generateMessages method when you want to generate a create message.
   * @param type - "create"
   * @param payload - The payload for the create message.
   * @param clientToken - The client token for which to generate the create message (used to get the type ID).
   * @return A create message with the specified payload and type ID.
   */
  protected createMessage(type: "create", payload: TCreatePayload, clientToken: ClientToken): CreateObjectMessage<TCreatePayload>;

  /**
   * Generates a change message, use this inside the generateMessages method when you want to generate a change message.
   * @param type - "change"
   * @param payload - The payload for the change message.
   * @returns A change message with the specified payload.
   */
  protected createMessage(type: "change", payload: TChangePayload): ChangeObjectMessage<TChangePayload>;

  /**
   * Generates a message for the instance being serialized, use this inside the generateMessages method when you want to generate a message.
   * @param type - The type of the message.
   * @param payload - The payload for the message.
   * @returns A message with the specified payload.
   */
  protected createMessage<TMessage extends Message>(type: string, payload?: Omit<TMessage, "type" | "objectId">): TMessage;

  protected createMessage(type: string, payload?: any, ...extraArguments: any[]): Message {
    const message: Message = {
      type,
      objectId: this.objectId,
    };

    if (isObjectMessage<CreateObjectMessage<TCreatePayload>>(message, CreateMessageType)) {
      message.data = payload;
      if (this._objectInfo.isRoot) message.isRoot = true;
      let typeId: string;
      if (extraArguments[0] instanceof ClientToken) {
        typeId = this.getTypeId(extraArguments[0])!;
      } else {
        typeId = extraArguments[0] as string;
      }
      message.typeId = typeId;
      message.data = payload;
    } else if (isObjectMessage<ChangeObjectMessage<TChangePayload>>(message, ChangeMessageType)) {
      message.data = payload;
    } else {
      Object.assign(message, payload);
    }
    return message;
  }

  set clientRestriction(filter: ClientTokenFilter | null) {
    if (!filter) {
      this._clientFilters = null;
      return;
    }
    this._clientFilters = {
      clientTokens: filter.clientTokens ? toIterable(filter.clientTokens, true) : undefined,
      identities: filter.identities ? toIterable(filter.identities, true) : undefined,
      isExclusive: filter.isExclusive ?? true,
    };
  }
  get clientRestriction() {
    return this._clientFilters;
  }

  isForClientToken(clientToken: ClientToken): boolean {
    if (!this._clientFilters) return true;

    const filter = this._clientFilters;
    return isForClientToken(clientToken, filter);
  }
}
