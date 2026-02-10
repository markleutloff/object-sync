import { Constructor } from "../../shared/index.js";
import { SyncAgent } from "../syncAgent.js";
import { SyncAgentProvider } from "../syncAgentProvider.js";

type SyncAgentSettings<TSyncAgent extends SyncAgent> = {
  /**
   * When provided will add a symbol to the type which tells it to use this serializer.
   * You can then use the type in the ObjectSync creation settings as serializer.
   */
  type: Constructor;

  /**
   * The typeId to use for this sync agent. If not provided, the name of the type will be used.
   */
  typeId?: string;
} & {
  /**
   * Whether this sync agent should be added to the default intrinsic sync agents list. Default is false.
   */
  defaultIntrinsicSyncAgentProvider?: boolean;
};

export function syncAgent<This extends new (...args: any) => SyncAgent>(settings: SyncAgentSettings<InstanceType<This>>) {
  return function syncObject(target: This, context: ClassDecoratorContext<This>) {
    context.addInitializer(function () {
      const provider = new SyncAgentProvider({
        syncAgentType: target,
        syncType: settings.type,
        typeId: settings.typeId ?? settings.type.name,
        matchExactType: true,
        isIntrinsic: "defaultIntrinsicSyncAgentProvider" in settings ? settings.defaultIntrinsicSyncAgentProvider : false,
      });
    });
  };
}
