import { ChangeObjectMessage, CreateObjectMessage, Message } from "../../../shared/messages.js";
import { ExtendedTypeSerializer } from "../../serializer.js";
import { defaultIntrinsicSerializers } from "../base.js";
import { ClientToken } from "../../../shared/clientToken.js";
import { ensureSyncArrayMetaInfo } from "./metaInfo.js";
import { SyncableArray } from "./syncArray.js";
import { SyncableObservableArray } from "./syncObservableArray.js";
import { SpliceInstruction, applyChangeSet, createChangeSet } from "./changeSet.js";

type TInstance = Array<any>;
type TCreatePayload = any[];
const TYPE_ID_NATIVEARRAY = "<nativeArray>";
const TYPE_ID_SYNCARRAY = "<syncArray>";
const TYPE_ID_OBSERVABLEARRAY = "<syncObservableArray>";

export interface ISyncArrayDispatcher<TElement = any> {
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
}

abstract class SyncArraySerializerBase extends ExtendedTypeSerializer<TInstance> {
  private _oldArrayContent: any[] = [];
  private _temporaryChanges: SpliceInstruction<any>[] | null = null;
  private _dispatcher: ISyncArrayDispatcher | undefined;
  private _changeSetMode?: "trackSplices" | "compareStates";

  public override onInstanceSet(createdByCreateObjectMessage: boolean): void {
    super.onInstanceSet(createdByCreateObjectMessage);

    const metaInfo = ensureSyncArrayMetaInfo(this.instance);
    metaInfo?.on("addChange", (instance, change) => {
      this.reportSplice(change.start, change.deletedItems.length, ...change.items);
    });

    if (createdByCreateObjectMessage) return;
  }

  private reportSplice(start: number, deleteCount: number, ...items: any[]) {
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

  private get changeSetMode() {
    return this._changeSetMode ?? this._objectInfo.owner.arrayChangeSetMode;
  }
  private set changeSetMode(value: "trackSplices" | "compareStates") {
    this._changeSetMode = value;
  }

  onCreateMessageReceived(message: CreateObjectMessage<TCreatePayload>, clientToken: ClientToken): void {
    if (message.typeId === TYPE_ID_SYNCARRAY) this.instance = new SyncableArray<any>();
    else if (message.typeId === TYPE_ID_OBSERVABLEARRAY) this.instance = new SyncableObservableArray<any>();
    else this.instance = new Array<any>();

    this.instance.push(...message.data.map((value) => this.deserializeValue(value, clientToken)));
  }

  override onChangeMessageReceived(message: ChangeObjectMessage<SpliceInstruction<any>[]>, clientToken: ClientToken): void {
    const deserializedSplices = message.data.map((change) => ({
      start: change.start,
      deleteCount: change.deleteCount,
      items: change.items.map((item) => this.deserializeValue(item, clientToken)),
    }));

    applyChangeSet(this.instance, deserializedSplices);
  }

  generateMessages(clientToken: ClientToken, isNewClientConnection: boolean): Message[] {
    const messages: Message[] = [];
    if (isNewClientConnection || this.hasPendingChanges) {
      if (!this._temporaryChanges && this.changeSetMode === "compareStates") {
        this._temporaryChanges = createChangeSet(this._oldArrayContent, this.instance);
      }
    }
    if (isNewClientConnection) {
      this.clearAllStoredReferencesWithClientConnection(clientToken);
      this.instance.forEach((element, index) => {
        this.storeReference(element, index, clientToken);
      });

      const data: any[] = [];
      this.instance.forEach((element, index) => {
        const mappedValue = this.serializeValue(element, clientToken);
        data.push(mappedValue);
      });

      const createMessage: CreateObjectMessage<TCreatePayload> = {
        type: "create",
        objectId: this.objectId,
        typeId: this.getTypeId(clientToken)!,
        data,
      };
      messages.push(createMessage);
    } else if (this.hasPendingChanges) {
      this._temporaryChanges?.forEach((change) => {
        for (let i = 0; i < change.deleteCount; i++) this.storeReference(undefined, change.start + i, clientToken);
        change.items.forEach((item, itemIndex) => {
          this.storeReference(item, change.start + itemIndex, clientToken);
        });
      });
      const data: SpliceInstruction<any>[] = this._temporaryChanges!.map((change) => ({
        start: change.start,
        deleteCount: change.deleteCount,
        items: change.items.map((item) => {
          const mappedValue = this.serializeValue(item, clientToken);
          return mappedValue;
        }),
      }));

      const changeMessage: ChangeObjectMessage<SpliceInstruction<any>[]> = {
        type: "change",
        objectId: this.objectId,
        data,
      };
      messages.push(changeMessage);
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

  override get dispatcher(): ISyncArrayDispatcher {
    return (this._dispatcher ??= this.createDispatcher());
  }

  private createDispatcher() {
    const self = this;
    const result = {
      reportSplice(...args: any[]) {
        if (args.length === 0 && self.changeSetMode !== "compareStates") {
          throw new Error("reportSplice requires parameters when arrayChangeSetMode is not 'compareStates'.");
        } else if (args.length !== 0 && self.changeSetMode !== "trackSplices") {
          throw new Error("reportSplice with parameters requires arrayChangeSetMode to be 'trackSplices'.");
        }
        (self.reportSplice as any)(...args);
      },
      get changeSetMode() {
        return self.changeSetMode;
      },
      set changeSetMode(value: "trackSplices" | "compareStates") {
        self.changeSetMode = value;
      },
    };
    return result as unknown as ISyncArrayDispatcher;
  }
}

export class ArraySerializer extends SyncArraySerializerBase {
  static canSerialize(instanceOrTypeId: object | string): boolean {
    if (typeof instanceOrTypeId === "string") {
      return instanceOrTypeId === TYPE_ID_NATIVEARRAY;
    }

    return instanceOrTypeId instanceof Array;
  }

  getTypeId(clientToken: ClientToken) {
    return TYPE_ID_NATIVEARRAY;
  }
}

export class SyncArraySerializer extends SyncArraySerializerBase {
  static canSerialize(instanceOrTypeId: object | string): boolean {
    if (typeof instanceOrTypeId === "string") {
      return instanceOrTypeId === TYPE_ID_SYNCARRAY;
    }

    return instanceOrTypeId instanceof SyncableArray;
  }

  getTypeId(clientToken: ClientToken) {
    return TYPE_ID_SYNCARRAY;
  }
}

export class SyncObservableArraySerializer extends SyncArraySerializerBase {
  static canSerialize(instanceOrTypeId: object | string): boolean {
    if (typeof instanceOrTypeId === "string") {
      return instanceOrTypeId === TYPE_ID_OBSERVABLEARRAY;
    }

    return instanceOrTypeId instanceof SyncableObservableArray;
  }

  getTypeId(clientToken: ClientToken) {
    return TYPE_ID_OBSERVABLEARRAY;
  }
}

defaultIntrinsicSerializers.push(SyncObservableArraySerializer);
defaultIntrinsicSerializers.push(SyncArraySerializer);
defaultIntrinsicSerializers.push(ArraySerializer);
