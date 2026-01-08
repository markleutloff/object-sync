import type { ClientConnection } from "../tracker/tracker.js";
import type { ChangeObjectMessage, CreateObjectMessage } from "../shared/messages.js";
import type { ObjectChangeApplicator } from "./applicator.js";

export const onCreated = Symbol("onCreated");
export const onUpdated = Symbol("onUpdated");
export const onUpdateProperty = Symbol("onUpdateProperty");
export const onDelete = Symbol("onDelete");
export const onDeleted = Symbol("onDeleted");

export interface ITrackableOnCreated<T extends object> {
  [onCreated](changes: CreateObjectMessage<T>, client: ObjectChangeApplicator, clientConnection?: ClientConnection): void;
}

export interface ITrackableOnUpdated<T extends object> {
  [onUpdated](changes: ChangeObjectMessage<T>, client: ObjectChangeApplicator, clientConnection?: ClientConnection): void;
}

export interface ITrackableOnDeleted {
  [onDeleted](client: ObjectChangeApplicator, clientConnection?: ClientConnection): void;
}

export interface ITrackableOnDelete {
  [onDelete](client: ObjectChangeApplicator, clientConnection?: ClientConnection): boolean;
}

export interface ITrackableOnUpdateProperty<T extends object> {
  [onUpdateProperty](key: keyof T, value: T[keyof T], isForCreate: boolean, client: ObjectChangeApplicator, clientConnection: ClientConnection): boolean;
}

function hasOnCreated<T extends object>(obj: any): obj is ITrackableOnCreated<T> {
  return onCreated in obj;
}

function hasOnDeleted(obj: any): obj is ITrackableOnDeleted {
  return onDeleted in obj;
}

function hasOnDelete(obj: any): obj is ITrackableOnDelete {
  return onDelete in obj;
}

function hasOnUpdated<T extends object>(obj: any): obj is ITrackableOnUpdated<T> {
  return onUpdated in obj;
}

function hasOnUpdateProperty<T extends object>(obj: any): obj is ITrackableOnUpdateProperty<T> {
  return onUpdateProperty in obj;
}

export function invokeOnCreated<T extends object>(obj: T, changes: CreateObjectMessage<T>, client: ObjectChangeApplicator, clientConnection?: ClientConnection) {
  if (hasOnCreated<T>(obj)) {
    obj[onCreated](changes, client, clientConnection);
  }
}

export function invokeOnUpdated<T extends object>(obj: T, changes: ChangeObjectMessage<T>, client: ObjectChangeApplicator, clientConnection?: ClientConnection) {
  if (hasOnUpdated<T>(obj)) {
    obj[onUpdated](changes, client, clientConnection);
  }
}

export function invokeOnDeleted<T extends object>(obj: T, client: ObjectChangeApplicator, clientConnection?: ClientConnection) {
  if (hasOnDeleted(obj)) {
    obj[onDeleted](client, clientConnection);
  }
}

export function invokeOnDelete<T extends object>(obj: T, client: ObjectChangeApplicator, clientConnection?: ClientConnection) {
  if (hasOnDelete(obj)) {
    obj[onDelete](client, clientConnection);
  }
  return true; // not handled
}

export function invokeOnUpdateProperty<T extends object>(obj: T, key: keyof T, value: T[keyof T], isForCreate: boolean, client: ObjectChangeApplicator, clientConnection: ClientConnection): boolean {
  if (hasOnUpdateProperty<T>(obj)) {
    return obj[onUpdateProperty](key, value, isForCreate, client, clientConnection);
  }
  return false; // not handled
}
