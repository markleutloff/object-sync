import { ChangeObjectMessage, CreateObjectMessage, Message } from "../../../shared/messages.js";
import { ExtendedTypeSerializer } from "../../serializer.js";
import { createSerializerClass } from "../base.js";
import { ObjectInfo } from "../../../shared/objectInfo.js";
import { ClientToken } from "../../../shared/clientToken.js";
import { Constructor } from "../../../shared/types.js";
import { SyncableSetMetaInfo } from "./metaInfo.js";
import { getMetaInfo } from "../../../shared/metaInfo.js";
import { SerializedValue } from "../../serializedTypes.js";

type TInstance = Set<any>;
type TCreatePayload = SerializedValue[];
type TChangePayload = (
  | {
      value: SerializedValue;
      delete: true;
    }
  | { value: SerializedValue }
  | {
      clear: true;
    }
)[];

type ChangeEntry =
  | {
      value: any;
      delete: true;
    }
  | { value: any }
  | {
      clear: true;
    };

const TYPE_ID_NATIVESET = "<nativeSet>";
const TYPE_ID_SYNCABLESET = "<syncableSet>";

export interface ISetDispatcher<TValue = any> {
  reportClear(): void;
  reportDelete(value: TValue): void;
  reportAdd(value: TValue): void;
}

abstract class SyncableSetSerializerBase extends ExtendedTypeSerializer<TInstance, TCreatePayload, TChangePayload> {
  private _changes: ChangeEntry[] = [];
  private _dispatcher: ISetDispatcher | undefined;

  constructor(
    private readonly _setType: Constructor<TInstance>,
    private readonly _typeId: string,
    objectInfo: ObjectInfo<TInstance>,
  ) {
    super(objectInfo);
  }

  getTypeId(clientToken: ClientToken) {
    return this._typeId;
  }

  override onInstanceSet(createdByCreateObjectMessage: boolean): void {
    super.onInstanceSet(createdByCreateObjectMessage);

    const metaInfo = getMetaInfo(this.instance, SyncableSetMetaInfo, true);
    metaInfo?.on("added", (instance, value) => {
      this.reportAdd(value);
    });
    metaInfo?.on("cleared", (instance) => {
      this.reportClear();
    });
    metaInfo?.on("deleted", (instance, value) => {
      this.reportDelete(value);
    });
  }

  reportClear() {
    this._changes.length = 0;
    this._changes.push({ clear: true } as any);
    this.hasPendingChanges = true;
  }

  reportAdd(value: any) {
    this._changes = this._changes.filter((change) => "value" in change && change.value !== value);
    this._changes.push({ value });
    this.hasPendingChanges = true;
  }

  reportDelete(value: any) {
    this._changes = this._changes.filter((change) => "value" in change && change.value !== value);
    this._changes.push({ value, delete: true });
    this.hasPendingChanges = true;
  }

  onCreateMessageReceived(message: CreateObjectMessage<TCreatePayload>, clientToken: ClientToken): void {
    this.instance = new this._setType();
    for (const value of message.data) {
      const deserializedValue = this.deserializeValue(value, clientToken);
      this.instance.add(deserializedValue);
    }
  }

  override onChangeMessageReceived(message: ChangeObjectMessage<TChangePayload>, clientToken: ClientToken): void {
    for (const change of message.data) {
      if ("clear" in change) {
        this.instance.clear();
        continue;
      } else if ("delete" in change) {
        const deserializedValue = this.deserializeValue(change.value, clientToken);
        this.instance.delete(deserializedValue);
        continue;
      } else {
        const deserializedValue = this.deserializeValue(change.value, clientToken);
        this.instance.add(deserializedValue);
      }
    }
  }

  generateMessages(clientToken: ClientToken, isNewClient: boolean): Message[] {
    if (!isNewClient && !this.hasPendingChanges) return [];

    if (isNewClient) {
      const message: CreateObjectMessage<TCreatePayload> = {
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
          key: change.value,
          clientToken,
        });
        const serializedValue = this.serializeValue(change.value, clientToken);
        return { value: serializedValue, delete: true };
      } else {
        this.storeReference({
          clientToken,
          key: change.value,
          value: change.value,
        });
        const serializedValue = this.serializeValue(change.value, clientToken);
        return { value: serializedValue };
      }
    });
  }

  private getCreationData(clientToken: ClientToken) {
    this.clearStoredReferencesWithClientToken(clientToken);

    const data: TCreatePayload = [];
    for (const value of this.instance) {
      this.storeReference({
        clientToken,
        key: value,
        value,
      });
      const serializedValue = this.serializeValue(value, clientToken);
      data.push(serializedValue);
    }
    return data;
  }

  override clearStates(clientToken?: ClientToken): void {
    super.clearStates(clientToken);
    if (!clientToken) this._changes.length = 0;
  }

  override get dispatcher(): ISetDispatcher {
    return (this._dispatcher ??= this.createDispatcher());
  }

  private createDispatcher() {
    const self = this;
    const result = {
      reportClear() {
        self.reportClear();
      },
      reportAdd(value: any) {
        self.reportAdd(value);
      },
      reportDelete(value: any) {
        self.reportDelete(value);
      },
    };
    return result as unknown as ISetDispatcher;
  }
}

export const SetSerializer = createSerializerClass(SyncableSetSerializerBase, Set, TYPE_ID_NATIVESET, true);
export const SyncableSetSerializer = createSerializerClass(SyncableSetSerializerBase, Set, TYPE_ID_SYNCABLESET, false);
