import { ObjectInfoBase } from "../shared/objectInfoBase.js";
import type { ObjectSyncMetaInfo } from "../shared/objectSyncMetaInfo.js";
import type { ObjectChangeApplicator } from "./applicator.js";

export class ApplicatorObjectInfo<T extends object> extends ObjectInfoBase {
  constructor(objectSyncMetaInfo: ObjectSyncMetaInfo, private readonly _applicator: ObjectChangeApplicator) {
    super(objectSyncMetaInfo);
  }

  get applicator(): ObjectChangeApplicator {
    return this._applicator;
  }
}
