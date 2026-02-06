import { ObjectInfo } from "../serialization/index.js";
import { Constructor, ClientToken } from "../shared/index.js";

export class ObjectPool {
  private readonly _objectToInfo: Map<object, ObjectInfo> = new Map();
  private readonly _objectIdToInfo: Map<unknown, ObjectInfo> = new Map();

  hasObject(instance: object): boolean {
    return this._objectToInfo.has(instance);
  }

  hasObjectId(objectId: unknown): boolean {
    return this._objectIdToInfo.has(objectId);
  }

  getInfoByObject(instance: object): ObjectInfo | undefined {
    return this._objectToInfo.get(instance);
  }

  getObjectById<T extends object = object>(objectId: unknown): T | undefined {
    return this._objectIdToInfo.get(objectId)?.instance as T | undefined;
  }

  getInfoById(objectId: unknown): ObjectInfo | undefined {
    return this._objectIdToInfo.get(objectId);
  }

  get objects(): object[] {
    return Array.from(this._objectIdToInfo.values()).map((info) => info.instance);
  }

  get infos(): ObjectInfo[] {
    return Array.from(this._objectIdToInfo.values());
  }

  objectInfosToDelete(clientToken: ClientToken): ObjectInfo[] {
    return this.infos.filter((info) => info.mustDeleteForClient(clientToken));
  }

  orphanedObjectInfos(clientToken: ClientToken): ObjectInfo[] {
    return this.infos.filter((info) => info.isOrphaned);
  }

  get ownedObjects(): object[] {
    return this.infos.filter((info) => info.isOwned).map((info) => info.instance!);
  }

  add(info: ObjectInfo): ObjectInfo {
    const { instance, objectId } = info;
    if (instance) this._objectToInfo.set(instance, info);
    this._objectIdToInfo.set(objectId, info);
    return info;
  }

  deleteByObject(instance: object): void {
    const info = this._objectToInfo.get(instance);
    if (info) {
      this._objectIdToInfo.delete(info.objectId);
      this._objectToInfo.delete(instance);
    }
  }

  deleteById(objectId: unknown): void {
    const info = this._objectIdToInfo.get(objectId);
    if (info) {
      this._objectToInfo.delete(info.instance);
      this._objectIdToInfo.delete(objectId);
    }
  }

  onObjectSet(info: ObjectInfo<object>) {
    this._objectToInfo.set(info.instance, info);
  }

  findOne<T extends object>(constructor: Constructor<T>, objectId?: unknown) {
    return this.infos.find((info) => {
      return info.instance && info.instance instanceof constructor && (objectId === undefined || info.objectId === objectId);
    })?.instance as T | undefined;
  }

  findAll<T extends object>(constructor: Constructor<T>) {
    return this.infos
      .filter((info) => {
        return info.instance && info.instance instanceof constructor;
      })
      .map((info) => info.instance as T);
  }
}
