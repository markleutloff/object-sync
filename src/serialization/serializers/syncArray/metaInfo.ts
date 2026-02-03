import { EventEmitter } from "../../../shared/eventEmitter.js";
import { SpliceInstruction, SpliceInstructionEx } from "./changeSet.js";
import { SyncableArray } from "./syncArray.js";

type SyncArrayMetaInfoEvents = {
  addChange(instance: SyncableArray<any>, change: SpliceInstructionEx<any>): void;
};

class SyncArrayMetaInfo extends EventEmitter<SyncArrayMetaInfoEvents> {
  reportArrayChanged(instance: SyncableArray<any>, change: SpliceInstructionEx<any>) {
    this.emit("addChange", instance, change);
  }
}

const metaInfoBySyncArray: WeakMap<SyncableArray<any>, SyncArrayMetaInfo> = new WeakMap();

export function ensureSyncArrayMetaInfo(instance: Array<any>): SyncArrayMetaInfo | undefined {
  if (!(instance instanceof SyncableArray)) return undefined;
  let metaInfo = getSyncArrayMetaInfo(instance);
  if (!metaInfo) {
    metaInfo = new SyncArrayMetaInfo();
    metaInfoBySyncArray.set(instance, metaInfo);
  }
  return metaInfo;
}

export function getSyncArrayMetaInfo(instance: SyncableArray<any>): SyncArrayMetaInfo | null {
  return metaInfoBySyncArray.get(instance) ?? null;
}
