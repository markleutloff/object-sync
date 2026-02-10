import { createDisposable, IDisposable, ClientToken } from "../shared/index.js";
import { SyncAgent } from "./syncAgent.js";
import { ObjectSyncCore } from "../objectSync/objectSyncCore.js";

export class ObjectInfo<TInstance extends object = object> {
  private _syncAgent: SyncAgent = null!;
  private _instance: TInstance | null = null;
  private _isOwned: boolean = false;

  private _referenceCountByClient: Map<ClientToken | undefined, number> = new Map();

  constructor(
    private _owner: ObjectSyncCore,
    private _objectId: string = null!,
    instanceOrTypeId: string | TInstance = null!,
    private _isRoot: boolean = false,
  ) {
    if (typeof instanceOrTypeId === "string") {
      this._objectId ??= this._owner.generateObjectId();
    } else {
      this._instance = instanceOrTypeId;
      this._objectId ??= this._owner.generateObjectId(this._instance);
    }
  }

  initializeSyncAgent(instanceOrTypeId: string | TInstance = null!): void {
    const provider = this._owner.syncAgentProviders.findOrThrow(instanceOrTypeId);
    this._syncAgent = provider.createAgent(this);
    if (this._instance) this._syncAgent.onInstanceSet(false);
  }

  get isOwned(): boolean {
    return this._isOwned;
  }
  set isOwned(value: boolean) {
    this._isOwned = this._isOwned || value;
  }

  get objectId(): string {
    return this._objectId;
  }

  get instance(): TInstance {
    return this._instance!;
  }
  set instance(value: TInstance) {
    if (value === this._instance) return;
    if (this._instance) throw new Error("Instance is already set and cannot be changed.");
    this._instance = value;
    this._owner.reportInstanceCreated(value, this._objectId);
  }

  get isRoot(): boolean {
    return this._isRoot;
  }
  set isRoot(value: boolean) {
    this._isRoot = value;
  }

  get syncAgent(): SyncAgent {
    return this._syncAgent;
  }

  get owner(): ObjectSyncCore {
    return this._owner;
  }

  addReference(clientToken?: ClientToken): IDisposable {
    this._referenceCountByClient.set(clientToken, (this._referenceCountByClient.get(clientToken) ?? 0) + 1);

    return createDisposable(() => {
      this.removeReference(clientToken);
    });
  }

  get isOrphaned(): boolean {
    if (this._isRoot || !this._isOwned) return false;
    for (const count of this._referenceCountByClient.values()) {
      if (count > 0) return false;
    }
    return true;
  }

  mustDeleteForClient(clientToken: ClientToken): boolean {
    return this._instance !== null && this._isOwned && !this._isRoot && this._syncAgent.clients.has(clientToken) && (this._referenceCountByClient.get(clientToken) ?? 0) <= 0;
  }

  private removeReference(clientToken?: ClientToken) {
    const currentCount = this._referenceCountByClient.get(clientToken);
    if (currentCount === undefined) return;

    if (currentCount <= 1) {
      this._referenceCountByClient.delete(clientToken);
    } else {
      this._referenceCountByClient.set(clientToken, currentCount - 1);
    }
  }

}
