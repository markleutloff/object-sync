import { ChangeObjectMessage, CreateObjectMessage } from "../shared/messages.js";
import { ObjectSyncClient } from "./client.js";

export const onCreated = Symbol("onCreated");
export const onUpdated = Symbol("onUpdated");
export const onUpdateProperty = Symbol("onUpdateProperty");
export const onDeleted = Symbol("onDeleted");

export interface ITrackableOnCreated<T extends object>  {
  [onCreated](changes: CreateObjectMessage<T>): void;
};

export interface ITrackableOnUpdated<T extends object> {
  [onUpdated](changes: ChangeObjectMessage<T>): void;
};

export interface ITrackableOnDeleted {
  [onDeleted](): void;
};

export interface ITrackableOnUpdateProperty<T extends object> {
  [onUpdateProperty](key: keyof T, value: T[keyof T], isForCreate: boolean, client: ObjectSyncClient): boolean;
};

function hasOnCreated<T extends object>(obj: any): obj is ITrackableOnCreated<T> {
  return onCreated in obj;
}

function hasOnDeleted(obj: any): obj is ITrackableOnDeleted {
  return onDeleted in obj;
}

function hasOnUpdated<T extends object>(obj: any): obj is ITrackableOnUpdated<T> {
  return onUpdated in obj;
}

function hasOnUpdateProperty<T extends object>(obj: any): obj is ITrackableOnUpdateProperty<T> {
  return onUpdateProperty in obj;
}

export function invokeOnCreated<T extends object>(obj: T, changes: CreateObjectMessage<T>) {
  if (hasOnCreated<T>(obj)) {
    obj[onCreated](changes);
  }
}

export function invokeOnUpdated<T extends object>(obj: T, changes: ChangeObjectMessage<T>) {
  if (hasOnUpdated<T>(obj)) {
    obj[onUpdated](changes);
  }
}

export function invokeOnDeleted<T extends object>(obj: T) {
  if (hasOnDeleted(obj)) {
    obj[onDeleted]();
  }
}

export function invokeOnUpdateProperty<T extends object>(obj: T, key: keyof T, value: T[keyof T], isForCreate: boolean, client: ObjectSyncClient): boolean {
  if (hasOnUpdateProperty<T>(obj)) {
    return obj[onUpdateProperty](key, value, isForCreate, client);
  }
  return false; // not handled
}