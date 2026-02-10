import { Constructor, AbstractConstructor } from "../../shared/index.js";
import { ExtendedSyncAgent } from "../extendedSyncAgent.js";
import { ObjectInfo } from "../objectInfo.js";
import { SyncAgentProvider } from "../syncAgentProvider.js";

export function createSyncAgentProvider<TSyncAgent extends ExtendedSyncAgent<any>>(
  baseClass: AbstractConstructor<TSyncAgent>,
  constructor: Constructor,
  typeId: string,
  isIntrinsic: boolean,
): SyncAgentProvider {
  const TypedSyncAgent = class extends (baseClass as any) {
    constructor(objectInfo: ObjectInfo) {
      super(constructor, typeId, objectInfo);
    }
  };

  const syncAgentProvider = new SyncAgentProvider({
    syncAgentType: TypedSyncAgent as any,
    syncType: constructor,
    typeId,
    isIntrinsic,
  });
  return syncAgentProvider;
}
