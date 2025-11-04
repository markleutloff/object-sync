import { HostObjectInfo } from "./hostObjectInfo.js";

export const onConvertedToTrackable = Symbol("onConvertedToTrackable");
export const onTick = Symbol("onTick");

export interface ITrackedOnConvertedToTrackable<T extends object> {
  [onConvertedToTrackable](info: HostObjectInfo<T>): void;
}

export interface ITrackedOnTick<T extends object> {
  [onTick](): void;
}

function hasOnConvertedToTrackable<T extends object>(obj: any): obj is ITrackedOnConvertedToTrackable<T> {
  return onConvertedToTrackable in obj;
}

function hasOnTick<T extends object>(obj: any): obj is ITrackedOnTick<T> {
  return onTick in obj;
}

export function invokeOnConvertedToTrackable<T extends object>(obj: T, info: HostObjectInfo<T>) {
  if (hasOnConvertedToTrackable<T>(obj)) {
    obj[onConvertedToTrackable](info);
  }
}

export function invokeOnTick<T extends object>(obj: T) {
  if (hasOnTick<T>(obj)) {
    obj[onTick]();
  }
}
