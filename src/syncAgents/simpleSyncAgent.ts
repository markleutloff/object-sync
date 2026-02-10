import { ClientToken, Constructor, CreateObjectMessage, Message } from "../shared/index.js";
import { ExtendedSyncAgent } from "./extendedSyncAgent.js";
import { SyncAgentProvider } from "./syncAgentProvider.js";

type SimpleTypeSyncAgentSettings<TInstance extends object, TPayload = any> = {
  type: Constructor<TInstance>;
  typeId: string;
  serialize: (obj: TInstance) => TPayload;
  deserialize: (data: TPayload) => TInstance;
};

export function createSimpleSyncAgentProvider<TInstance extends object, TPayload = any>(settings: SimpleTypeSyncAgentSettings<TInstance, TPayload>) {
  const { type, typeId, serialize, deserialize } = settings;

  const SyncAgent = class SimpleSyncAgent extends ExtendedSyncAgent<TInstance> {
    override getTypeId(clientToken: ClientToken): string {
      return typeId;
    }

    override generateMessages(clientToken: ClientToken, isNewClient: boolean): Message[] {
      if (isNewClient) return [this.createMessage("create", serialize(this.instance), clientToken)];
      return [];
    }

    onCreateMessageReceived(message: CreateObjectMessage, clientToken: ClientToken): void {
      this.instance = deserialize(message.data as TPayload);
    }
  };

  const agentProvider = new SyncAgentProvider({
    syncAgentType: SyncAgent,
    syncType: type,
    typeId,
    matchExactType: true,
  });

  return agentProvider;
}
