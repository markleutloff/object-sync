import { mapIterable } from "./types.js";
import { ClientConnection } from "../tracker/tracker.js";
import { ChangeTrackerObjectInfo } from "../tracker/trackerObjectInfo.js";
import { ObjectChangeApplicator, TypeSerializer } from "../applicator/applicator.js";

export type NativeTypeSerializer = TypeSerializer<any> & { typeId: string };

export const nativeArraySerializer: NativeTypeSerializer = {
  type: Array,
  typeId: "<NativeArray>",
  serialize(instance: Array<any>, trackerInfo: ChangeTrackerObjectInfo<any>) {
    return mapIterable(instance, (item) => {
      const propertyInfo = trackerInfo.createPropertyInfo(item);
      return propertyInfo;
    });
  },
  deserialize(value: any, applicator: ObjectChangeApplicator, clientConnection: ClientConnection) {
    return value.map((item: any) => {
      return applicator.getPropertyValue(item, clientConnection);
    });
  },
};

export const nativeMapSerializer: NativeTypeSerializer = {
  type: Map,
  typeId: "<NativeMap>",
  serialize(instance: Map<any, any>, trackerInfo: ChangeTrackerObjectInfo<any>) {
    const result: Record<string, any> = {};
    for (const [key, value] of instance.entries()) {
      const propertyInfo = trackerInfo.createPropertyInfo(value);
      result[key] = propertyInfo;
    }
    return result;
  },
  deserialize(value: any, applicator: ObjectChangeApplicator, clientConnection: ClientConnection) {
    const result = new Map<any, any>();
    for (const [key, item] of Object.entries(value)) {
      result.set(key, applicator.getPropertyValue(item as any, clientConnection));
    }
    return result;
  },
};

export const nativeSetSerializer: NativeTypeSerializer = {
  type: Set,
  typeId: "<NativeSet>",
  serialize(instance: Set<any>, trackerInfo: ChangeTrackerObjectInfo<any>) {
    const result: Array<any> = [];
    for (const value of instance.values()) {
      const propertyInfo = trackerInfo.createPropertyInfo(value);
      result.push(propertyInfo);
    }
    return result;
  },
  deserialize(value: any, applicator: ObjectChangeApplicator, clientConnection: ClientConnection) {
    const result = new Set<any>();
    for (const item of value) {
      result.add(applicator.getPropertyValue(item as any, clientConnection));
    }

    return result;
  },
};

export const nativeObjectSerializer: NativeTypeSerializer = {
  type: Object,
  typeId: "<NativeObject>",
  serialize(instance: object, trackerInfo: ChangeTrackerObjectInfo<any>) {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(instance)) {
      const propertyInfo = trackerInfo.createPropertyInfo(value);
      result[key] = propertyInfo;
    }
    return result;
  },
  deserialize(value: any, applicator: ObjectChangeApplicator, clientConnection: ClientConnection) {
    const result: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = applicator.getPropertyValue(item as any, clientConnection);
    }
    return result;
  },
};

export const nativeTypeSerializers: NativeTypeSerializer[] = [nativeSetSerializer, nativeMapSerializer, nativeArraySerializer, nativeObjectSerializer];
