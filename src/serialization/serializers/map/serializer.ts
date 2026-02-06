import { getMetaInfo, SerializedValue, Constructor, ClientToken, ChangeObjectMessage, CreateObjectMessage, Message } from "../../../shared/index.js";
import { ExtendedTypeSerializer } from "../../extendedTypeSerializer.js";
import { createSerializerClass } from "../base.js";
import { SyncableMap } from "./syncableMap.js";
import { SyncMapMetaInfo } from "./metaInfo.js";
import { SyncableObservableMap } from "./syncableObservableMap.js";
import { ObjectInfo } from "../../objectInfo.js";

type TInstance = Map<any, any>;
type TCreatePayload = {
  key: SerializedValue;
  value: SerializedValue;
}[];

type TChangePayload = (
  | {
      key: SerializedValue;
      delete: true;
    }
  | { key: SerializedValue; value: SerializedValue }
  | {
      clear: true;
    }
)[];

type ChangeEntry =
  | {
      key: any;
      delete: true;
    }
  | { key: any; value: any }
  | {
      clear: true;
    };

const TYPE_ID_NATIVEMAP = "<nativeMap>";
const TYPE_ID_SYNCABLEMAP = "<syncableMap>";
const TYPE_ID_SYNCABLEOBSERVABLEMAP = "<syncableObservableMap>";

export interface IMapDispatcher<TKey = any, TValue = any> {
  reportClear(): void;
  reportDelete(key: TKey): void;
  reportChange(key: TKey, value: TValue): void;
}

abstract class SyncableMapSerializerBase extends ExtendedTypeSerializer<TInstance, TCreatePayload, TChangePayload> {
  private _changes: ChangeEntry[] = [];
  private _dispatcher: IMapDispatcher | undefined;

  constructor(
    private readonly _mapType: Constructor<TInstance>,
    private readonly _typeId: string,
    objectInfo: ObjectInfo<TInstance>,
  ) {
    super(objectInfo);
  }

  override getTypeId(clientToken: ClientToken): string | null {
    return this._typeId;
  }

  override onInstanceSet(createdByCreateObjectMessage: boolean): void {
    super.onInstanceSet(createdByCreateObjectMessage);

    const metaInfo = getMetaInfo(this.instance, SyncMapMetaInfo, true);
    metaInfo?.on("changed", (instance, key, value) => {
      this.reportChange(key, value);
    });
    metaInfo?.on("cleared", (instance) => {
      this.reportClear();
    });
    metaInfo?.on("deleted", (instance, key) => {
      this.reportDelete(key);
    });
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

  onCreateMessageReceived(message: CreateObjectMessage<TCreatePayload>, clientToken: ClientToken): void {
    this.instance = new this._mapType();
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

  generateMessages(clientToken: ClientToken, isNewClient: boolean): Message[] {
    if (isNewClient) return [this.createMessage("create", this.getCreationData(clientToken), clientToken)];
    else if (this.hasPendingChanges) return [this.createMessage("change", this.getChangeData(clientToken))];
    return [];
  }

  private getChangeData(clientToken: ClientToken): TChangePayload {
    return this._changes.map((change) => {
      if ("clear" in change) {
        this.clearStoredReferences(clientToken);
        return { clear: true };
      } else if ("delete" in change) {
        this.clearStoredReferences(change.key, clientToken);
        const serializedKey = this.serializeValue(change.key, clientToken);
        return { key: serializedKey, delete: true };
      } else {
        this.storeReference({
          clientToken,
          key: change.key,
          values: [change.key, change.value],
        });
        const [key, value] = this.serializeValue({
          clientToken,
          key: change.key,
          values: [change.key, change.value],
        });
        return { key, value };
      }
    });
  }

  private getCreationData(clientToken: ClientToken) {
    this.clearStoredReferences(clientToken);

    const data: TCreatePayload = [];
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

export const SyncableObservableMapSerializer = createSerializerClass(SyncableMapSerializerBase, SyncableObservableMap, TYPE_ID_SYNCABLEOBSERVABLEMAP, false);
export const SyncableMapSerializer = createSerializerClass(SyncableMapSerializerBase, SyncableMap, TYPE_ID_SYNCABLEMAP, false);
export const MapSerializer = createSerializerClass(SyncableMapSerializerBase, Map, TYPE_ID_NATIVEMAP, true);
