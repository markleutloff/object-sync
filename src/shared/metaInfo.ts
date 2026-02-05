import { EventEmitter, EventMap } from "./eventEmitter.js";
import { Constructor } from "./types.js";

const metaInfoByInstance: WeakMap<object, MetaInfo> = new WeakMap();

export abstract class MetaInfo<Events extends EventMap = EventMap> extends EventEmitter<Events> {}

export function getMetaInfo<TMetaInfo extends MetaInfo>(
  instance: object,
  metaInfoType: Constructor<TMetaInfo>,
  metaInfoGeneratorOrCreateByConstructor?: boolean | ((instance: object) => TMetaInfo | null),
): TMetaInfo | null {
  let metaInfo: TMetaInfo | null = (metaInfoByInstance.get(instance) as TMetaInfo) ?? null;
  if (metaInfo) {
    if (!(metaInfo instanceof metaInfoType)) return null;
    return metaInfo as TMetaInfo;
  }

  // When we should NOT generate the MetaInfo return null early
  if (metaInfoGeneratorOrCreateByConstructor === false || metaInfoGeneratorOrCreateByConstructor === undefined) return null;
  
  const metaInfoGenerator = typeof metaInfoGeneratorOrCreateByConstructor === "function" ? metaInfoGeneratorOrCreateByConstructor : undefined;
  metaInfo = metaInfoGenerator ? metaInfoGenerator(instance) : new metaInfoType();

  if (!metaInfo) return null;
  metaInfoByInstance.set(instance, metaInfo);

  return metaInfo;
}
