import type { ApplicatorObjectInfo } from "../applicator/applicatorObjectInfo.js";
import type { ChangeTrackerObjectInfo } from "../tracker/trackerObjectInfo.js";
import { getTrackableTypeInfo } from "../tracker/decorators.js";

export const objectSyncSymbol = Symbol("objectSync");

export type ObjectSyncMetaInfo = {
  objectId: unknown;
  typeId: string;
  object: object;
  client?: ApplicatorObjectInfo<any>;
  host?: ChangeTrackerObjectInfo<any>;
};

export function getObjectSyncMetaInfo(target: object): ObjectSyncMetaInfo | undefined {
  if (!target || typeof target !== "object") return undefined;
  if (typeof target === "function") return undefined;

  return (target as any)[objectSyncSymbol] as ObjectSyncMetaInfo | undefined;
}

let nextObjectId = 1;

export function createObjectId(objectIdPrefix: string): string {
  return `${objectIdPrefix}${nextObjectId++}`;
}

export type ObjectSyncMetaInfoCreateSettings<T extends object = object> =
  | {
      object: T;
      objectIdPrefix: string;
      typeId?: string;
      objectId?: unknown;
    }
  | {
      object: T;
      typeId: string;
      objectId: unknown;
    };

export function ensureObjectSyncMetaInfo(settings: ObjectSyncMetaInfoCreateSettings): ObjectSyncMetaInfo {
  let metaInfo = getObjectSyncMetaInfo(settings.object);
  if (metaInfo) return metaInfo;

  if (!("objectId" in settings) && !("objectIdPrefix" in settings)) {
    throw new Error("objectIdPrefix must be provided when objectId is provided");
  }

  const typeId = settings.typeId ?? getTrackableTypeInfo(settings.object.constructor as any)?.typeId ?? settings.object.constructor.name;
  const objectId = settings.objectId ?? createObjectId((settings as any).objectIdPrefix);

  metaInfo = {
    objectId,
    typeId,
    object: settings.object,
  };

  (settings.object as any)[objectSyncSymbol] = metaInfo;
  return metaInfo;
}

export function getHostObjectInfo<T extends object>(obj: T): ChangeTrackerObjectInfo<T> | null {
  return getObjectSyncMetaInfo(obj)?.host ?? null;
}

export function getClientObjectInfo<T extends object>(obj: T): ApplicatorObjectInfo<T> | null {
  return getObjectSyncMetaInfo(obj)?.client ?? null;
}
