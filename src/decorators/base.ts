import { EventEmitter } from "../shared/eventEmitter.js";
import { TrackedMethodInfo } from "./syncMethod.js";
import { TrackedPropertyInfo } from "./syncProperty.js";

export const nothing = Symbol("nothing");

type ObjectSyncMetaInfoEvents = {
  propertyChanged(propertyInfo: TrackedPropertyInfo<any, any>, instance: object, propertyKey: string, value: any): void;
};

class ObjectSyncMetaInfo extends EventEmitter<ObjectSyncMetaInfoEvents> {
  reportPropertyChanged(instance: object, propertyInfo: TrackedPropertyInfo<any, any>, propertyKey: string, value: any) {
    this.emit("propertyChanged", propertyInfo, instance, propertyKey, value);
  }
}
const metaInfoByValue: WeakMap<object, ObjectSyncMetaInfo> = new WeakMap();

export function ensureObjectSyncMetaInfo(instance: object): ObjectSyncMetaInfo {
  let metaInfo = metaInfoByValue.get(instance);
  if (!metaInfo) {
    metaInfo = new ObjectSyncMetaInfo();
    metaInfoByValue.set(instance, metaInfo);
  }
  return metaInfo;
}

export function getObjectSyncMetaInfo(instance: object): ObjectSyncMetaInfo | null {
  return metaInfoByValue.get(instance) || null;
}
