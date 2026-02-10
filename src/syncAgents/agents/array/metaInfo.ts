import { MetaInfo } from "../../../shared/index.js";
import { SpliceInstructionEx } from "./changeSet.js";

type SyncArrayMetaInfoEvents = {
  spliced(instance: Array<any>, change: SpliceInstructionEx<any>): void;
};

export class SyncArrayMetaInfo extends MetaInfo<SyncArrayMetaInfoEvents> {
  reportSplice(instance: Array<any>, change: SpliceInstructionEx<any>) {
    this.emit("spliced", instance, change);
  }
}
