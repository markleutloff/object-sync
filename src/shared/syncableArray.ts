import { ObjectChangeApplicator } from "../applicator/applicator.js";
import { ITrackableOnUpdateProperty, onUpdateProperty } from "../applicator/trackableTarget.js";
import { syncObject } from "../tracker/decorators.js";
import { ClientConnection } from "../tracker/tracker.js";
import { ChangeTrackerObjectInfo } from "../tracker/trackerObjectInfo.js";
import { ITrackedOnConvertedToTrackable, ITrackedOnTick, onConvertedToTrackable, onTick } from "../tracker/interfaces.js";
import { isPropertyInfoSymbol, PropertyInfo } from "./messages.js";
import { getHostObjectInfo } from "./objectSyncMetaInfo.js";

export type SyncableArrayChange<T> = { start: number; deleteCount: number; items: PropertyInfo<any, any>[] };

@syncObject({
  typeId: "SyncableArray",
  properties: {
    _changes: {},
    _creation: {},
  },
})
export class SyncableArray<T> implements ITrackableOnUpdateProperty<any>, ITrackedOnConvertedToTrackable<SyncableArray<T>>, ITrackedOnTick<SyncableArray<T>> {
  private _values: T[] = [];
  private _changes: SyncableArrayChange<T>[] = [];
  private _creation: PropertyInfo<any, any>[] = [];

  constructor(initial: T[] = []) {
    this.push(...initial);
  }

  get value(): T[] {
    return this._values;
  }

  set value(value: T[]) {
    this.clear();
    this.push(...value);
  }

  clear() {
    this.length = 0;
  }

  changeAt(index: number, value: T) {
    this._values[index] = value;

    this.onRemoved(index, [value]);
    this.onAdded(index, [value]);

    const hostObjectInfo = getHostObjectInfo(this);
    if (hostObjectInfo) {
      this._creation[index] = this.convertItemToPropertyInfo(hostObjectInfo, value);
      this.addChange({ start: index, deleteCount: 1, items: this.convertItemsToPropertyInfos(hostObjectInfo, [value]) });
    }
  }

  get length(): number {
    return this._values.length;
  }

  set length(value: number) {
    if (value < this._values.length) {
      this.splice(value, this._values.length - value);
    } else if (value > this._values.length) {
      this.push(...(new globalThis.Array(value - this._values.length).fill(undefined) as T[]));
    }
  }

  push(...items: T[]): number {
    if (items.length === 0) return this._values.length;

    const startIndex = this._values.length;
    this._values.push(...items);

    const hostObjectInfo = getHostObjectInfo(this);
    if (hostObjectInfo) {
      this._creation.push(...this.convertItemsToPropertyInfos(hostObjectInfo, items));
      this.addChange({ start: startIndex, deleteCount: 0, items: this.convertItemsToPropertyInfos(hostObjectInfo, items) });
    }

    this.onAdded(startIndex, items);
    return this._values.length;
  }

  private convertPropertyInfosToItems(items: PropertyInfo<any, any>[], client: ObjectChangeApplicator, clientConnection: ClientConnection): T[] {
    return items.map((item) => client.getPropertyValue(item, clientConnection));
  }

  splice(start: number, deleteCount?: number, ...items: T[]): T[] {
    deleteCount ??= this._values.length - start;
    if (deleteCount === 0 && items.length === 0) return [];

    const removedItems = this._values.splice(start, deleteCount, ...items);
    if (removedItems.length > 0) this.onRemoved(start, removedItems);
    if (items.length > 0) this.onAdded(start, items);

    const hostObjectInfo = getHostObjectInfo(this);
    if (hostObjectInfo) {
      const convertedItems = this.convertItemsToPropertyInfos(hostObjectInfo, items);
      this._creation.splice(start, deleteCount, ...convertedItems);
      this.addChange({ start, deleteCount, items: convertedItems });
    }

    return removedItems;
  }

  private addChange(pendingChange: SyncableArrayChange<T> | null) {
    this.onPropertyChanged("_changes", this._changes);

    while (pendingChange) {
      const lastChange = this._changes[this._changes.length - 1];
      if (!lastChange) {
        this._changes.push(pendingChange);
        return;
      }

      // Try to merge consecutive pushes at the end
      if (lastChange.deleteCount === 0 && pendingChange.deleteCount === 0 && lastChange.start + lastChange.items.length === pendingChange.start) {
        // Merge pushes at the end
        lastChange.items.push(...pendingChange.items);
        // After merging, try to merge lastChange with the previous one
        pendingChange = this._changes.pop()!;
        continue;
      }

      // Try to merge a removal at the end with a previous push
      if (
        lastChange.deleteCount === 0 &&
        pendingChange.deleteCount > 0 &&
        pendingChange.items.length === 0 &&
        lastChange.start + lastChange.items.length === pendingChange.start + pendingChange.deleteCount &&
        pendingChange.start >= lastChange.start
      ) {
        // Only remove from the end of the last push
        const removeCount = pendingChange.deleteCount;
        const newLength = lastChange.items.length - removeCount;
        if (newLength > 0) {
          lastChange.items.length = newLength;
          // After merging, try to merge lastChange with the previous one
          pendingChange = this._changes.pop()!;
          continue;
        } else {
          // If all items are removed, remove the last change
          this._changes.pop();
          // After removing, try to merge with the new last change
          pendingChange = pendingChange;
          continue;
        }
      }

      // Try to merge a removal inside a previous push
      if (
        lastChange.deleteCount === 0 &&
        pendingChange.deleteCount > 0 &&
        pendingChange.items.length === 0 &&
        pendingChange.start >= lastChange.start &&
        pendingChange.start < lastChange.start + lastChange.items.length &&
        pendingChange.start + pendingChange.deleteCount <= lastChange.start + lastChange.items.length
      ) {
        // Remove items from inside the previous push
        const relativeStart = pendingChange.start - lastChange.start;
        lastChange.items.splice(relativeStart, pendingChange.deleteCount);
        // After merging, try to merge lastChange with the previous one
        pendingChange = this._changes.pop()!;
        continue;
      }

      // No merge possible, just push
      this._changes.push(pendingChange);
      return;
    }
  }

  private convertItemsToPropertyInfos(serverObjectInfo: ChangeTrackerObjectInfo<any>, items: T[]): PropertyInfo<any, any>[] {
    return items.map((item) => this.convertItemToPropertyInfo(serverObjectInfo, item));
  }

  private convertItemToPropertyInfo(serverObjectInfo: ChangeTrackerObjectInfo<any>, item: T): PropertyInfo<any, any> {
    const metaInfo = serverObjectInfo.convertToTrackableObjectReference(item as any);
    const transformed: PropertyInfo<any, any> = {
      value: item,
      objectId: metaInfo?.objectId,
      [isPropertyInfoSymbol]: true,
    };

    return transformed;
  }

  [Symbol.iterator]() {
    return this._values[Symbol.iterator]();
  }

  private onPropertyChanged(property: string, value: any) {
    const host = getHostObjectInfo(this);
    if (!host) return;

    host.onPropertyChanged(property as any, value);
  }

  [onTick](): void {
    this._changes = [];
  }

  [onConvertedToTrackable](hostObjectInfo: ChangeTrackerObjectInfo<SyncableArray<T>>): void {
    this._creation = [...this.convertItemsToPropertyInfos(hostObjectInfo, this._values)];
    this.onPropertyChanged("_creation", this._creation);
    this.onPropertyChanged("_changes", this._changes);
  }

  [onUpdateProperty](key: string | number | symbol, value: any, isForCreate: boolean, client: ObjectChangeApplicator, clientConnection: ClientConnection): boolean {
    if (isForCreate && key === "_creation") {
      this.value = this.convertPropertyInfosToItems(value, client, clientConnection);
    } else if (!isForCreate && key === "_changes") {
      this.applyTrackableArrayChanges(this._values, value, client, clientConnection);
    }
    return true;
  }

  private applyTrackableArrayChanges(arr: T[], changes: SyncableArrayChange<T>[], client: ObjectChangeApplicator, clientConnection: ClientConnection): T[] {
    for (const change of changes) {
      const newItems = this.convertPropertyInfosToItems(change.items, client, clientConnection);
      const removedItems = arr.splice(change.start, change.deleteCount, ...newItems);
      if (removedItems.length > 0) this.onRemoved(change.start, removedItems);
      if (change.items.length > 0) this.onAdded(change.start, newItems);
    }
    return arr;
  }

  // toJson and toValue
  toJSON() {
    return this._values;
  }

  toValue() {
    return this._values;
  }

  protected onRemoved(start: number, items: T[]): void {
    // Can be used in subclasses
  }

  protected onAdded(start: number, items: T[]): void {
    // Can be used in subclasses
  }
}
