import { Constructor } from "../../../shared/index.js";
import { getTrackableTypeInfo } from "./decorators/syncObject.js";
import { SyncObjectSyncAgent } from "./agent.js";
import { ObjectInfo } from "../../objectInfo.js";
import { SyncAgentProvider } from "../../syncAgentProvider.js";

const syncAgentProvidersByType: Map<Constructor, SyncAgentProvider> = new Map();

export function getSyncObjectSyncAgentProvider<TInstance extends object>(type: Constructor<TInstance>): SyncAgentProvider {
  if (syncAgentProvidersByType.has(type)) {
    return syncAgentProvidersByType.get(type)!;
  }

  const typeId = getTrackableTypeInfo(type)!.typeId;

  const TypedSyncObjectyncAgent = class TypedSyncObjectyncAgent extends SyncObjectSyncAgent<TInstance> {
    get type(): Constructor {
      return type;
    }

    constructor(objectInfo: ObjectInfo<TInstance>) {
      super(objectInfo, typeId);
    }
  };

  const provider = new SyncAgentProvider({
    syncAgentType: TypedSyncObjectyncAgent,
    syncType: type,
    typeId,
    matchExactType: true,
    isIntrinsic: false,
  });

  syncAgentProvidersByType.set(type, provider);
  return provider;
}
