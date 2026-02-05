import { ChangeObjectMessage, CreateObjectMessage, Message } from "../../../shared/messages.js";
import { ExtendedTypeSerializer } from "../../serializer.js";
import { defaultIntrinsicSerializers } from "../base.js";
import { ObjectInfo } from "../../../shared/objectInfo.js";
import { ClientToken } from "../../../shared/clientToken.js";
import { SyncableMap } from "../index.js";

type TInstance = Map<any, any>;
type TPayload = {
  key: any;
  value: any;
}[];

type TChangePayload = (
  | {
      key: any;
      delete: true;
    }
  | { key: any; value: any }
  | {
      clear: true;
    }
)[];

const TYPE_ID_NATIVEMAP = "<nativeMap>";
const TYPE_ID_SYNCABLEMAP = "<syncableMap>";

export interface IMapDispatcher<TKey = any, TValue = any> {
  reportClear(): void;
  reportDelete(key: TKey): void;
  reportChange(key: TKey, value: TValue): void;
}

abstract class SyncableMapSerializerBase extends ExtendedTypeSerializer<TInstance, TPayload> {
  private _changes: TChangePayload = [];
  private _dispatcher: IMapDispatcher | undefined;

  constructor(objectInfo: ObjectInfo<TInstance>) {
    super(objectInfo);
  }

  override onInstanceSet(createdByCreateObjectMessage: boolean): void {
    super.onInstanceSet(createdByCreateObjectMessage);
  }

  reportClear() {
    this._changes.length = 0;
    this._changes.push({ clear: true } as any);
    this.hasPendingChanges = true;
  }

  reportChange(key: any, value: any) {
    this._changes.push({ key, value });
    this.hasPendingChanges = true;
  }

  reportDelete(key: any) {
    this._changes = this._changes.filter((change) => "key" in change && change.key !== key);
    this._changes.push({ key, delete: true });
    this.hasPendingChanges = true;
  }

  onCreateMessageReceived(message: CreateObjectMessage<TPayload>, clientToken: ClientToken): void {
    this.instance = new Map();
    for (const { key, value } of message.data) {
      const deserializedKey = this.deserializeValue(key, clientToken);
      const deserializedValue = this.deserializeValue(value, clientToken);
      this.instance.set(deserializedKey, deserializedValue);
    }
  }

  override onChangeMessageReceived(message: ChangeObjectMessage<TChangePayload>, clientToken: ClientToken): void {
    for (const change of message.data) {
      if ("clear" in change) {
        this.instance.clear();
        continue;
      } else if ("delete" in change) {
        const deserializedKey = this.deserializeValue(change.key, clientToken);
        this.instance.delete(deserializedKey);
        continue;
      } else {
        const deserializedKey = this.deserializeValue(change.key, clientToken);
        const deserializedValue = this.deserializeValue(change.value, clientToken);
        this.instance.set(deserializedKey, deserializedValue);
      }
    }
  }

  generateMessages(clientToken: ClientToken, isNewClientConnection: boolean): Message[] {
    if (!isNewClientConnection && !this.hasPendingChanges) return [];

    if (isNewClientConnection) {
      const message: CreateObjectMessage<TPayload> = {
        type: "create",
        objectId: this.objectId,
        typeId: this.getTypeId(clientToken)!,
        data: this.getCreationData(clientToken),
      };
      return [message];
    } else {
      const message: ChangeObjectMessage<TChangePayload> = {
        type: "change",
        objectId: this.objectId,
        data: this.getChangeData(clientToken),
      };
      return [message];
    }
    return [];
  }

  private getChangeData(clientToken: ClientToken): TChangePayload {
    return this._changes.map((change) => {
      if ("clear" in change) {
        this.clearStoredReferencesWithClientToken(clientToken);
        return { clear: true };
      } else if ("delete" in change) {
        this.storeReference({
          value: undefined,
          key: change.key,
          clientToken,
        });
        const serializedKey = this.serializeValue(change.key, clientToken);
        return { key: serializedKey, delete: true };
      } else {
        this.storeReference({
          clientToken,
          key: change.key,
          values: [change.key, change.value],
        });
        const serializedKey = this.serializeValue(change.key, clientToken);
        const serializedValue = this.serializeValue(change.value, clientToken);
        return { key: serializedKey, value: serializedValue };
      }
    });
  }

  private getCreationData(clientToken: ClientToken) {
    this.clearStoredReferencesWithClientToken(clientToken);

    const data: TPayload = [];
    for (const [key, value] of this.instance) {
      this.storeReference({
        clientToken,
        key,
        values: [key, value],
      });
      const serializedKey = this.serializeValue(key, clientToken);
      const serializedValue = this.serializeValue(value, clientToken);
      data.push({ key: serializedKey, value: serializedValue });
    }
    return data;
  }

  override clearStates(clientToken?: ClientToken): void {
    super.clearStates(clientToken);
    if (!clientToken) this._changes.length = 0;
  }

  override get dispatcher(): IMapDispatcher {
    return (this._dispatcher ??= this.createDispatcher());
  }

  private createDispatcher() {
    const self = this;
    const result = {
      reportClear() {
        self.reportClear();
      },
      reportChange(key: any, value: any) {
        self.reportChange(key, value);
      },
      reportDelete(key: any) {
        self.reportDelete(key);
      },
    };
    return result as unknown as IMapDispatcher;
  }
}

export class MapSerializer extends SyncableMapSerializerBase {
  static canSerialize(instanceOrTypeId: object | string): boolean {
    if (typeof instanceOrTypeId === "string") {
      return instanceOrTypeId === TYPE_ID_NATIVEMAP;
    }

    return instanceOrTypeId instanceof Map;
  }

  getTypeId(clientToken: ClientToken) {
    return TYPE_ID_NATIVEMAP;
  }
}

export class SyncableMapSerializer extends SyncableMapSerializerBase {
  static canSerialize(instanceOrTypeId: object | string): boolean {
    if (typeof instanceOrTypeId === "string") {
      return instanceOrTypeId === TYPE_ID_SYNCABLEMAP;
    }

    return instanceOrTypeId instanceof SyncableMap;
  }

  getTypeId(clientToken: ClientToken) {
    return TYPE_ID_SYNCABLEMAP;
  }
}

defaultIntrinsicSerializers.push(MapSerializer);
