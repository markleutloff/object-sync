import { MetaInfo } from "../../../shared/index.js";

type SyncableSetMetaInfoEvents = {
  cleared(instance: Set<any>): void;
  deleted(instance: Set<any>, value: any): void;
  added(instance: Set<any>, value: any): void;
};

export class SyncableSetMetaInfo extends MetaInfo<SyncableSetMetaInfoEvents> {
  reportClear(instance: Set<any>): void {
    this.emit("cleared", instance);
  }

  reportDelete(instance: Set<any>, value: any): void {
    this.emit("deleted", instance, value);
  }

  reportAdd(instance: Set<any>, value: any): void {
    this.emit("added", instance, value);
  }
}
