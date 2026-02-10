import { ClientToken, Constructor, getMetaInfo, SerializedValue, ChangeObjectMessage, CreateObjectMessage, Message } from "../../../shared/index.js";
import { ExtendedSyncAgent } from "../../extendedSyncAgent.js";
import { createSyncAgentProvider } from "../base.js";
import { SyncableSetMetaInfo } from "./metaInfo.js";
import { SyncableSet } from "./syncableSet.js";
import { SyncableObservableSet } from "./syncableObservableSet.js";
import { ObjectInfo } from "../../objectInfo.js";
import { ISyncAgent } from "../../syncAgent.js";

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
const TYPE_ID_SYNCABLEOBSERVABLESET = "<syncableObservableSet>";

export interface ISetSyncAgent<TValue = any> extends ISyncAgent<Set<TValue>> {
  reportClear(): void;
  reportDelete(value: TValue): void;
  reportAdd(value: TValue): void;

  /**
   * Gets or sets the allowed types which can be sent from the sender. This is a security measure to prevent clients from sending unexpected types which may be used to cause issues on the receiving end (e.g., by sending very large objects or objects with getters that execute expensive code). If not set, all types provided by sync agents will be allowed.
   */
  allowedTypesFromSender: Constructor[] | undefined;
}

abstract class SyncableSetSyncAgentBase extends ExtendedSyncAgent<TInstance, TCreatePayload, TChangePayload> implements ISetSyncAgent {
  private _changes: ChangeEntry[] = [];
  private _allowedTypesFromSender?: Constructor[] | undefined;

  constructor(
    private readonly _setType: Constructor<TInstance>,
    private readonly _typeId: string,
    objectInfo: ObjectInfo<TInstance>,
  ) {
    super(objectInfo);
  }

  get allowedTypesFromSender() {
    return this._allowedTypesFromSender;
  }
  set allowedTypesFromSender(value: Constructor[] | undefined) {
    this._allowedTypesFromSender = value;
  }

  override getTypeId(clientToken: ClientToken): string | null {
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
    if (this.isApplyingMessages) return;
    this._changes.length = 0;
    this._changes.push({ clear: true } as any);
    this.hasPendingChanges = true;
  }

  reportAdd(value: any) {
    if (this.isApplyingMessages) return;
    this._changes = this._changes.filter((change) => "value" in change && change.value !== value);
    this._changes.push({ value });
    this.hasPendingChanges = true;
  }

  reportDelete(value: any) {
    if (this.isApplyingMessages) return;
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
        const deserializedValue = this.deserializeValue(change.value, clientToken, this.allowedTypesFromSender);
        this.instance.delete(deserializedValue);
        continue;
      } else {
        const deserializedValue = this.deserializeValue(change.value, clientToken, this.allowedTypesFromSender);
        this.instance.add(deserializedValue);
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
        this.clearStoredReferences(change.value, clientToken);
        const serializedValue = this.serializeValue(change.value, clientToken);
        return { value: serializedValue, delete: true };
      } else {
        const serializedValue = this.serializeValue({
          clientToken,
          key: change.value,
          value: change.value,
        });
        return { value: serializedValue };
      }
    });
  }

  private getCreationData(clientToken: ClientToken) {
    this.clearStoredReferences(clientToken);

    const data: TCreatePayload = [];
    for (const value of this.instance) {
      const serializedValue = this.serializeValue({ value, key: value, clientToken });
      data.push(serializedValue);
    }
    return data;
  }

  override clearStates(clientToken?: ClientToken): void {
    super.clearStates(clientToken);
    if (!clientToken) this._changes.length = 0;
  }
}

export const SyncableObservableSetSyncAgentProvider = createSyncAgentProvider(SyncableSetSyncAgentBase, SyncableObservableSet, TYPE_ID_SYNCABLEOBSERVABLESET, false);
export const SyncableSetSyncAgentProvider = createSyncAgentProvider(SyncableSetSyncAgentBase, SyncableSet, TYPE_ID_SYNCABLESET, false);
export const SetSyncAgentProvider = createSyncAgentProvider(SyncableSetSyncAgentBase, Set, TYPE_ID_NATIVESET, true);
