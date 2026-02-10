import { EventEmitter, IEventEmitter } from "../../../shared/index.js";
import { SyncableSet } from "./syncableSet.js";

type SyncableObservableSetEventMap<T = any> = {
  added: (value: T) => void;
  cleared: () => void;
  deleted: (value: T) => void;
};

export class SyncableObservableSet<T = any> extends SyncableSet<T> implements IEventEmitter<SyncableObservableSetEventMap<T>> {
  private readonly _eventEmitter = new EventEmitter<SyncableObservableSetEventMap<T>>();

  override add(value: T): this {
    super.add(value);
    this._eventEmitter.emit("added", value);
    return this;
  }

  override clear(): void {
    super.clear();
    this._eventEmitter.emit("cleared");
  }

  override delete(value: T): boolean {
    const result = super.delete(value);
    if (result) {
      this._eventEmitter.emit("deleted", value);
    }
    return result;
  }

  public on<Event extends keyof SyncableObservableSetEventMap>(event: Event, callback: SyncableObservableSetEventMap[Event]): void {
    this._eventEmitter.on(event, callback);
  }

  public once<Event extends keyof SyncableObservableSetEventMap>(event: Event, callback: SyncableObservableSetEventMap[Event]): void {
    this._eventEmitter.once(event, callback);
  }

  public off<Event extends keyof SyncableObservableSetEventMap>(event: Event, callback: SyncableObservableSetEventMap[Event]): void {
    this._eventEmitter.off(event, callback);
  }

  public listenerCount<Event extends keyof SyncableObservableSetEventMap>(event: Event, callback?: SyncableObservableSetEventMap[Event] | undefined): number {
    return this._eventEmitter.listenerCount(event, callback);
  }
}
