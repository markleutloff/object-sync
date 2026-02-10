import { Constructor } from "../shared/index.js";
import { defaultIntrinsicSyncAgentProviders, defaultSyncAgentProviders, SyncAgentProvider } from "../syncAgents/index.js";
import { ObjectSyncSettings } from "./types.js";

export class SyncAgentProviders {
  private readonly commonAgentProviders: SyncAgentProvider[];
  private readonly intrinsicsAgentProviders: SyncAgentProvider[];

  constructor(settings: ObjectSyncSettings) {
    this.commonAgentProviders = (settings.types ?? defaultSyncAgentProviders).map((o) => getSyncAgentProvider(o, false));
    this.intrinsicsAgentProviders = (settings.intrinsics ?? defaultIntrinsicSyncAgentProviders).map((o) => getSyncAgentProvider(o, true));
  }

  get all() {
    return [...this.commonAgentProviders, ...this.intrinsicsAgentProviders];
  }

  get common() {
    return this.commonAgentProviders;
  }

  get intrinsics() {
    return this.intrinsicsAgentProviders;
  }

  findOrThrow(instanceOrTypeId: object | string): SyncAgentProvider {
    const syncAgent = this.find(instanceOrTypeId);
    if (!syncAgent) throw new Error(`No sync agent provider found for value of type ${typeof instanceOrTypeId === "string" ? instanceOrTypeId : instanceOrTypeId.constructor.name}`);
    return syncAgent;
  }

  find(instanceOrTypeId: object | string): SyncAgentProvider | null {
    const syncAgent = this.commonAgentProviders.find((s) => s.canProvideAgentFor(instanceOrTypeId)) ?? this.intrinsicsAgentProviders.find((s) => s.canProvideAgentFor(instanceOrTypeId));
    return syncAgent ?? null;
  }
}

function getSyncAgentProvider(typeOrProvider: Constructor | SyncAgentProvider, isIntrinsic: boolean): SyncAgentProvider {
  if (isSyncAgentProvider(typeOrProvider)) {
    return typeOrProvider;
  }
  // The typeOrProvider value is a Constructor, but we need an instance to check if a provider can provide an agent for it, so we create a fake instance with the correct prototype.
  const fakeInstance = Object.setPrototypeOf({}, typeOrProvider.prototype);

  const providers = isIntrinsic ? defaultIntrinsicSyncAgentProviders : defaultSyncAgentProviders;
  const provider = providers.find((p) => p.canProvideAgentFor(fakeInstance));
  if (!provider) {
    throw new Error(`No sync agent provider found for type ${typeOrProvider.name}.`);
  }

  return provider;
}

function isSyncAgentProvider(obj: any): obj is SyncAgentProvider {
  return obj && typeof obj.canProvideAgentFor === "function" && typeof obj.createAgent === "function";
}
