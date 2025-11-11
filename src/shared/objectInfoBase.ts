import type { ObjectSyncMetaInfo } from "./objectSyncMetaInfo.js";

export class ObjectInfoBase {
  constructor(private readonly _objectSyncMetaInfo: ObjectSyncMetaInfo) {}

  get objectId(): unknown {
    return this._objectSyncMetaInfo.objectId;
  }

  get typeId(): string {
    return this._objectSyncMetaInfo.typeId;
  }

  get object(): object {
    return this._objectSyncMetaInfo.object;
  }

  get objectSyncMetaInfo() {
    return this._objectSyncMetaInfo;
  }
}
