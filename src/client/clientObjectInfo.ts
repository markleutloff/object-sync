import { ObjectInfoBase, ObjectSyncMetaInfo } from "../shared/objectSyncMetaInfo.js";

export class ClientObjectInfo<T extends object> extends ObjectInfoBase {
  constructor(objectSyncMetaInfo: ObjectSyncMetaInfo) {
    super(objectSyncMetaInfo);
  }
}
