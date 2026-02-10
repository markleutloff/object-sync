import { Constructor } from "../shared/index.js";
import { ObjectInfo } from "./objectInfo.js";
import { SyncAgent } from "./syncAgent.js";

export const defaultSyncAgentProviders: SyncAgentProvider[] = [];
export const defaultIntrinsicSyncAgentProviders: SyncAgentProvider[] = [];

type SyncAgentConstructor = new (objectInfo: ObjectInfo<any>) => SyncAgent;

export type SyncAgentProviderSettings = {
  /**
   * The type of the SyncAgent that should be instanciated for the given syncType. This is used to determine which SyncAgent to use when creating a new SyncAgent for an object of the given syncType.
   */
  syncAgentType: SyncAgentConstructor;

  /**
   * The type that this SyncAgent can be used for. When creating a new SyncAgent for an object, the SyncAgentProvider will be asked if it can provide a SyncAgent for the object's type (or one of its base types). The first SyncAgentProvider that returns true will be used to create the SyncAgent for the object.
   */
  syncType: Constructor;

  /**
   * The typeId that this SyncAgent can be used for. This is used to determine which SyncAgent to use when deserializing an object from a message that contains a typeId. The first SyncAgentProvider that returns true for the typeId will be used to create the SyncAgent for the object.
   */
  typeId: string;

  /**
   * If true, the SyncAgentProvider will only be used for objects that are exactly of the syncType. If false or undefined, the SyncAgentProvider will be used for objects that are of the syncType or any of its subtypes. The default is false.
   */
  matchExactType?: boolean;

  /**
   * Whether this SyncAgentProvider should be added to the default intrinsic SyncAgentProviders list. Default is false. Intrinsic SyncAgentProviders are used by default when creating SyncAgents for objects, and are checked after non-intrinsic SyncAgentProviders.
   */
  isIntrinsic?: boolean;

  /**
   * The priority of the SyncAgentProvider. When multiple SyncAgentProviders can provide a SyncAgent for a given type or typeId, the one with the highest priority will be used. The default priority is 0.
   */
  priority?: number;
};

/**
 * The SyncAgentProvider is responsible for providing SyncAgents for a given type or typeId. When a new SyncAgent is needed for an object, the SyncAgentProvider will be asked if it can provide a SyncAgent for the object's type (or one of its base types) or typeId. The first SyncAgentProvider that returns true will be used to create the SyncAgent for the object.
 */
export class SyncAgentProvider {
  constructor(private readonly _settings: SyncAgentProviderSettings) {
    if (_settings.isIntrinsic) defaultIntrinsicSyncAgentProviders.push(this);
    else defaultSyncAgentProviders.push(this);
  }

  public get priority(): number {
    return this._settings.priority ?? 0;
  }

  public get syncType(): Constructor {
    return this._settings.syncType;
  }

  public canProvideAgentFor(typeOrTypeId: object | string): boolean {
    if (typeof typeOrTypeId === "string") {
      return typeOrTypeId === this._settings.typeId;
    }
    if (this._settings.matchExactType) {
      return typeOrTypeId.constructor === this._settings.syncType;
    } else {
      return typeOrTypeId instanceof this._settings.syncType;
    }
  }

  public createAgent(objectInfo: ObjectInfo): SyncAgent {
    return new this._settings.syncAgentType(objectInfo);
  }
}
