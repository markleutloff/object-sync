import { EventEmitter, IEventEmitter } from "../../../shared/index.js";
import { SyncableMap } from "./syncableMap.js";

type SyncableObservableMapEventMap<K = any, V = any> = {
  set: (key: K, value: V) => void;
  cleared: () => void;
  deleted: (key: K) => void;
};

export class SyncableObservableMap<K = any, V = any> extends SyncableMap<K, V> implements IEventEmitter<SyncableObservableMapEventMap<K, V>> {
  private readonly _eventEmitter = new EventEmitter<SyncableObservableMapEventMap<K, V>>();

  override set(key: K, value: V): this {
    super.set(key, value);
    this._eventEmitter.emit("set", key, value);
    return this;
  }

  override clear(): void {
    super.clear();
    this._eventEmitter.emit("cleared");
  }

  override delete(key: K): boolean {
    const result = super.delete(key);
    if (result) {
      this._eventEmitter.emit("deleted", key);
    }
    return result;
  }

  public on<Event extends keyof SyncableObservableMapEventMap>(event: Event, callback: SyncableObservableMapEventMap[Event]): void {
    this._eventEmitter.on(event, callback);
  }

  public once<Event extends keyof SyncableObservableMapEventMap>(event: Event, callback: SyncableObservableMapEventMap[Event]): void {
    this._eventEmitter.once(event, callback);
  }

  public off<Event extends keyof SyncableObservableMapEventMap>(event: Event, callback: SyncableObservableMapEventMap[Event]): void {
    this._eventEmitter.off(event, callback);
  }

  public listenerCount<Event extends keyof SyncableObservableMapEventMap>(event: Event, callback?: SyncableObservableMapEventMap[Event] | undefined): number {
    return this._eventEmitter.listenerCount(event, callback);
  }
}
