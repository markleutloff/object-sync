import { ClientToken, EventEmitter } from "../shared/index.js";
import { ObjectInfo } from "../serialization/index.js";

type EventMap = {
  freed(objectId: string, clients: Set<ClientToken>): void;
};
export class WeakObjectPool extends EventEmitter<EventMap> {
  private readonly _objectToInfoMap: WeakMap<object, ObjectInfo> = new WeakMap();
  private readonly _objectIdToWeakRefMap: Map<string, WeakRef<ObjectInfo>> = new Map();
  private readonly _finalizationRegistry: FinalizationRegistry<string>;
  private readonly _objectIdClientTokens: Map<string, Set<ClientToken>> = new Map();

  constructor() {
    super();
    this._finalizationRegistry = new FinalizationRegistry((objectId) => {
      // finally remove from the id map
      const clients = this._objectIdClientTokens.get(objectId) || new Set();
      this._objectIdClientTokens.delete(objectId);
      this._objectIdToWeakRefMap.delete(objectId);
      this.emit("freed", objectId, clients);
    });
  }

  add(info: ObjectInfo) {
    this._objectToInfoMap.set(info.instance, info);
    this._objectIdToWeakRefMap.set(info.objectId, new WeakRef(info));
    this._finalizationRegistry.register(info.instance, info.objectId);
    this._objectIdClientTokens.set(info.objectId, info.serializer.clients);
  }

  delete(info: ObjectInfo) {
    this._objectToInfoMap.delete(info.instance);
    this._finalizationRegistry.unregister(info.instance);
    this._objectIdToWeakRefMap.delete(info.objectId);
    this._objectIdClientTokens.delete(info.objectId);
  }

  extractByObjectId(objectId: string): ObjectInfo | null {
    const weakRef = this._objectIdToWeakRefMap.get(objectId);
    if (!weakRef) return null;
    const info = weakRef.deref() || null;
    if (info) this.delete(info);
    return info;
  }

  extractByInstance(object: object): ObjectInfo | null {
    const info = this._objectToInfoMap.get(object) || null;
    if (info) this.delete(info);
    return info;
  }
}
