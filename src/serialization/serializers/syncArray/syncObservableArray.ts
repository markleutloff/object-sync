import { EventEmitter, IEventEmitter } from "../../../shared/eventEmitter.js";
import { SpliceInstruction, SpliceInstructionEx } from "./changeSet.js";
import { SyncableArray } from "./syncArray.js";

type SyncableObservableArrayEventMap = {
  added: (items: any[], start: number) => void;
  removed: (items: any[], start: number) => void;
};

export type ObservableArray<T = any[]> = T[] & IEventEmitter<SyncableObservableArrayEventMap>;

export class SyncableObservableArray<T = any> extends SyncableArray<T> implements IEventEmitter<SyncableObservableArrayEventMap> {
  private readonly _eventEmitter: EventEmitter<SyncableObservableArrayEventMap> = new EventEmitter<SyncableObservableArrayEventMap>();

  override onSplice(spliceInstruction: SpliceInstructionEx<T>) {
    super.onSplice(spliceInstruction);
    if (spliceInstruction.deletedItems.length > 0 && this._eventEmitter.listenerCount("removed") > 0) {
      this._eventEmitter.emit("removed", spliceInstruction.deletedItems, spliceInstruction.start);
    }

    if (spliceInstruction.items.length > 0 && this._eventEmitter.listenerCount("added") > 0) {
      this._eventEmitter.emit("added", spliceInstruction.items, spliceInstruction.start);
    }
  }

  public on<Event extends keyof SyncableObservableArrayEventMap>(event: Event, callback: SyncableObservableArrayEventMap[Event]): void {
    this._eventEmitter.on(event, callback);
  }

  public once<Event extends keyof SyncableObservableArrayEventMap>(event: Event, callback: SyncableObservableArrayEventMap[Event]): void {
    this._eventEmitter.once(event, callback);
  }

  public off<Event extends keyof SyncableObservableArrayEventMap>(event: Event, callback: SyncableObservableArrayEventMap[Event]): void {
    this._eventEmitter.off(event, callback);
  }

  public listenerCount<Event extends keyof SyncableObservableArrayEventMap>(event: Event, callback?: SyncableObservableArrayEventMap[Event] | undefined): number {
    return this._eventEmitter.listenerCount(event, callback);
  }
}
