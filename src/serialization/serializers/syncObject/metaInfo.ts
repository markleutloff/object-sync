import { MetaInfo } from "../../../shared/index.js";
import { TrackedPropertyInfo } from "./decorators/syncProperty.js";

type ObjectSyncMetaInfoEvents = {
  propertyChanged(propertyInfo: TrackedPropertyInfo<any, any>, instance: object, propertyKey: string, value: any): void;
};

export class ObjectSyncMetaInfo extends MetaInfo<ObjectSyncMetaInfoEvents> {
  reportPropertyChanged(instance: object, propertyInfo: TrackedPropertyInfo<any, any>, propertyKey: string, value: any) {
    this.emit("propertyChanged", propertyInfo, instance, propertyKey, value);
  }
}
