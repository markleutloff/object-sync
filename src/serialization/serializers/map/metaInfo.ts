import { MetaInfo } from "../../../shared/index.js";

type SyncMapMetaInfoEvents = {
  cleared(instance: Map<any, any>): void;
  deleted(instance: Map<any, any>, key: any): void;
  changed(instance: Map<any, any>, key: any, value: any): void;
};

export class SyncMapMetaInfo extends MetaInfo<SyncMapMetaInfoEvents> {
  reportClear(instance: Map<any, any>): void {
    this.emit("cleared", instance);
  }

  reportDelete(instance: Map<any, any>, key: any): void {
    this.emit("deleted", instance, key);
  }

  reportChange(instance: Map<any, any>, key: any, value: any): void {
    this.emit("changed", instance, key, value);
  }
}
