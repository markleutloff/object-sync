import { SerializedValue, Constructor, getMetaInfo, ClientToken, ChangeObjectMessage, CreateObjectMessage, Message } from "../../../shared/index.js";
import { ExtendedSyncAgent } from "../../extendedSyncAgent.js";
import { createSyncAgentProvider } from "../base.js";
import { SyncArrayMetaInfo } from "./metaInfo.js";
import { SyncableArray } from "./syncableArray.js";
import { SyncableObservableArray } from "./syncableObservableArray.js";
import { SpliceInstruction, applyChangeSet, createChangeSet } from "./changeSet.js";
import { ObjectInfo } from "../../objectInfo.js";
import { ISyncAgent } from "../../syncAgent.js";

type TInstance = Array<any>;
type TCreatePayload = SerializedValue[];
type TChangePayload = SpliceInstruction<SerializedValue>[];
type ChangeEntry = SpliceInstruction<any>;

const TYPE_ID_NATIVEARRAY = "<nativeArray>";
const TYPE_ID_SYNCARRAY = "<syncArray>";
const TYPE_ID_OBSERVABLEARRAY = "<syncObservableArray>";

export interface IArraySyncAgent<TElement = any> extends ISyncAgent<Array<TElement>> {
  /**
   * Reports a splice operation on the array. Can be used to manually notify about changes (for plain Arrays).
   * Will throw an error if arrayChangeSetMode is not set to "compareStates".
   * @param spliceInstruction - The splice instruction describing the change.
   */
  reportSplice(): void;

  /**
   * Reports a splice operation on the array. Can be used to manually notify about changes (for plain Arrays).
   * Will throw an error if arrayChangeSetMode is not set to "trackSplices".
   * @param start - The start index of the splice.
   * @param deleteCount - The number of items deleted.
   * @param items - The items inserted.
   */
  reportSplice(start: number, deleteCount: number, ...items: TElement[]): void;

  /**
   * Gets or sets the array change set mode, default value is the value from the ObjectSync settings.
   */
  changeSetMode: "trackSplices" | "compareStates";

  /**
   * Gets or sets the allowed types which can be sent from the sender for this array. This is a security measure to prevent clients from sending unexpected types which may be used to cause issues on the receiving end (e.g., by sending very large objects or objects with getters that execute expensive code). If not set, all types provided by sync agents will be allowed.
   */
  allowedTypesFromSender: Constructor[] | undefined;
}

class SyncableArraySyncAgentBase extends ExtendedSyncAgent<TInstance, TCreatePayload, TChangePayload> implements IArraySyncAgent {
  private _oldArrayContent: any[] = [];
  private _temporaryChanges: ChangeEntry[] | null = null;
  private _changeSetMode?: "trackSplices" | "compareStates";
  private _allowedTypesFromSender?: Constructor[] | undefined;

  constructor(
    private readonly _arrayType: Constructor<TInstance>,
    private readonly _typeId: string,
    objectInfo: ObjectInfo<TInstance>,
  ) {
    super(objectInfo);
  }

  override getTypeId(clientToken: ClientToken): string | null {
    return this._typeId;
  }

  public override onInstanceSet(createdByCreateObjectMessage: boolean): void {
    super.onInstanceSet(createdByCreateObjectMessage);

    const metaInfo = getMetaInfo(this.instance, SyncArrayMetaInfo, true);
    metaInfo?.on("spliced", (instance, change) => {
      this.reportSplice(change.start, change.deletedItems.length, ...change.items);
    });

    if (createdByCreateObjectMessage) return;
  }

  reportSplice(...args: any[]) {
    if (this.isApplyingMessages) {
      return;
    }
    if (args.length === 0 && this.changeSetMode !== "compareStates") {
      throw new Error("reportSplice requires parameters when arrayChangeSetMode is not 'compareStates'.");
    }
    (this.reportSpliceInternal as any)(...args);
  }

  private reportSpliceInternal(start: number, deleteCount: number, ...items: any[]) {
    this.hasPendingChanges = true;

    if (this.changeSetMode === "trackSplices") {
      if (!this._temporaryChanges) this._temporaryChanges = [];
      this._temporaryChanges.push({
        start,
        deleteCount,
        items,
      });
    } else {
      this._temporaryChanges = null;
    }
  }

  get changeSetMode() {
    return this._changeSetMode ?? this._objectInfo.owner.arrayChangeSetMode;
  }
  set changeSetMode(value: "trackSplices" | "compareStates") {
    this._changeSetMode = value;
  }

  get allowedTypesFromSender() {
    return this._allowedTypesFromSender;
  }
  set allowedTypesFromSender(value: Constructor[] | undefined) {
    this._allowedTypesFromSender = value;
  }

  onCreateMessageReceived(message: CreateObjectMessage<TCreatePayload>, clientToken: ClientToken): void {
    this.instance = new this._arrayType();
    this.instance.push(...message.data.map((value) => this.deserializeValue(value, clientToken, this.allowedTypesFromSender)));
  }

  override onChangeMessageReceived(message: ChangeObjectMessage<TChangePayload>, clientToken: ClientToken): void {
    const deserializedSplices = message.data.map((change) => ({
      start: change.start,
      deleteCount: change.deleteCount,
      items: change.items.map((item) => this.deserializeValue(item, clientToken)),
    }));

    applyChangeSet(this.instance, deserializedSplices);
  }

  generateMessages(clientToken: ClientToken, isNewClient: boolean): Message[] {
    const messages: Message[] = [];
    if (isNewClient || this.hasPendingChanges) {
      if (!this._temporaryChanges && this.changeSetMode === "compareStates") {
        this._temporaryChanges = createChangeSet(this._oldArrayContent, this.instance);
      }
    }
    if (isNewClient) {
      this.clearStoredReferences(clientToken);

      const data = this.instance.map((element, index) =>
        this.serializeValue({
          clientToken,
          value: element,
          key: index,
        }),
      );

      messages.push(this.createMessage("create", data, clientToken));
    } else if (this.hasPendingChanges) {
      const data: SpliceInstruction<any>[] = this._temporaryChanges!.map((change) => {
        // only clear stored references for deleted items,
        // for inserted items the references will be stored when serializing the new values so we skip those
        for (let i = change.items.length; i < change.deleteCount; i++) {
          this.clearStoredReferences(change.start + i, clientToken);
        }

        return {
          start: change.start,
          deleteCount: change.deleteCount,
          items: change.items.map((item, itemIndex) => this.serializeValue({ value: item, key: change.start + itemIndex, clientToken })),
        };
      });

      messages.push(this.createMessage("change", data));
    }
    return messages;
  }

  override clearStates(clientToken: ClientToken): void {
    super.clearStates(clientToken);
    if (!clientToken) {
      this._oldArrayContent = this.instance.slice();
      this._temporaryChanges = null;
    }
  }
}

export const SyncableObservableArraySyncAgentProvider = createSyncAgentProvider(SyncableArraySyncAgentBase, SyncableObservableArray, TYPE_ID_OBSERVABLEARRAY, false);
export const SyncableArraySyncAgentProvider = createSyncAgentProvider(SyncableArraySyncAgentBase, SyncableArray, TYPE_ID_SYNCARRAY, false);
export const ArraySyncAgentProvider = createSyncAgentProvider(SyncableArraySyncAgentBase, Array, TYPE_ID_NATIVEARRAY, true);
