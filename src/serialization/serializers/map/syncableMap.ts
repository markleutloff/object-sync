import { getMetaInfo } from "../../../shared/index.js";
import { SyncMapMetaInfo } from "./metaInfo.js";

export class SyncableMap<K = any, V = any> extends Map<K, V> {
  constructor(iterable?: Iterable<readonly [K, V]> | null) {
    super(iterable);
  }

  override set(key: K, value: V): this {
    super.set(key, value);
    getMetaInfo(this, SyncMapMetaInfo)?.reportChange(this, key, value);
    return this;
  }

  override clear(): void {
    super.clear();
    getMetaInfo(this, SyncMapMetaInfo)?.reportClear(this);
  }

  override delete(key: K): boolean {
    const result = super.delete(key);
    if (result) {
      getMetaInfo(this, SyncMapMetaInfo)?.reportDelete(this, key);
    }
    return result;
  }
}
