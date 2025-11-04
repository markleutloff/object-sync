import { ObjectSyncMetaInfo, getObjectSyncMetaInfo, createObjectId } from "./objectSyncMetaInfo.js";

export class TrackedObjectPool {
  private _trackedObjectInfos = new Map<unknown, ObjectSyncMetaInfo>();

  add(object: object) {
    const metaInfo = getObjectSyncMetaInfo(object);
    if (!metaInfo) throw new Error("Object is not trackable.");

    if (this.hasById(metaInfo?.objectId)) return;

    this._trackedObjectInfos.set(metaInfo.objectId, metaInfo);
  }

  delete(object: object): boolean {
    const metaInfo = getObjectSyncMetaInfo(object);
    if (!metaInfo) return false;

    return this._trackedObjectInfos.delete(metaInfo.objectId);
  }

  deleteById(objectId: unknown): boolean {
    return this._trackedObjectInfos.delete(objectId);
  }

  get(objectId: unknown): object | null {
    const metaInfo = this._trackedObjectInfos.get(objectId);
    return metaInfo?.object ?? null;
  }

  has(object: object): boolean {
    const metaInfo = getObjectSyncMetaInfo(object);
    if (!metaInfo) return false;

    return this._trackedObjectInfos.has(metaInfo.objectId);
  }

  hasById(objectId: unknown): boolean {
    return this._trackedObjectInfos.has(objectId);
  }

  get allMetaInfos(): ObjectSyncMetaInfo[] {
    const result: ObjectSyncMetaInfo[] = [];
    this._trackedObjectInfos.forEach((info) => result.push(info));
    return result;
  }

  get all(): object[] {
    const result: object[] = [];
    this._trackedObjectInfos.forEach((info) => result.push(info.object));
    return result;
  }
}
