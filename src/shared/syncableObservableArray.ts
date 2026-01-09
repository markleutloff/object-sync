import { syncObject } from "../tracker/decorators.js";
import { SyncableArray } from "./syncableArray.js";
import { IEventEmitter, EventEmitter } from "./eventEmitter.js";

type SyncableObservableArrayEventMap = {
  added: (items: any[], start: number) => void;
  removed: (items: any[], start: number) => void;
};

/**
 * A SyncableObservableArray is a SyncableArray that emits events when items are added or removed.
 * This allows observers to react to changes in the array's contents.
 */
@syncObject({
  typeId: "SyncableObservableArray",
})
export class SyncableObservableArray<T> extends SyncableArray<T> implements IEventEmitter<SyncableObservableArrayEventMap> {
  private readonly _eventEmitter: EventEmitter<SyncableObservableArrayEventMap> = new EventEmitter<SyncableObservableArrayEventMap>();

  constructor(initial: T[] = []) {
    super();
    this.push(...initial);
  }

  protected override onRemoved(start: number, items: T[]): void {
    this._eventEmitter.emit("removed", items, start);
  }

  protected override onAdded(start: number, items: T[]): void {
    this._eventEmitter.emit("added", items, start);
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
