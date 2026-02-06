import { getMetaInfo } from "../../../shared/index.js";
import { SyncableSetMetaInfo } from "./metaInfo.js";

export class SyncableSet<V> extends Set<V> {
  constructor(iterable?: Iterable<V> | null) {
    super(iterable);
  }

  override add(value: V): this {
    const alreadyHas = this.has(value);
    super.add(value);
    if (!alreadyHas) {
      getMetaInfo(this, SyncableSetMetaInfo)?.reportAdd(this, value);
    }
    return this;
  }

  override clear(): void {
    super.clear();
    getMetaInfo(this, SyncableSetMetaInfo)?.reportClear(this);
  }

  override delete(value: V): boolean {
    const result = super.delete(value);
    if (result) {
      getMetaInfo(this, SyncableSetMetaInfo)?.reportDelete(this, value);
    }
    return result;
  }
}
