import { Constructor } from "../shared/index.js";
import { ObjectInfo } from "../syncAgents/index.js";
import { ObjectSyncCore } from "./objectSyncCore.js";

export class ObjectsView {
  constructor(
    private readonly _core: ObjectSyncCore,
    private readonly _predicate?: (info: ObjectInfo) => boolean,
  ) {}

  protected get core() {
    return this._core;
  }

  /**
   * Finds a tracked object by its object ID.
   * @param objectId Object ID to find a specific object.
   * @returns The found object, or undefined if not found.
   */
  findOne<T extends object>(objectId: string): T | undefined;

  /**
   * Finds a tracked object by its constructor and optional object ID.
   * @param constructor The constructor of the object type to find.
   * @param objectId Optional object ID to find a specific object.
   * @returns The found object, or undefined if not found.
   */
  findOne<T extends object>(constructor: Constructor<T>, objectId?: string): T | undefined;

  findOne<T extends object>(constructorOrObjectId: Constructor<T> | string, objectId?: string) {
    return this._core.findOne(constructorOrObjectId, objectId, this._predicate);
  }

  /**
   * Finds all tracked objects of a specific type.
   * @param constructor The constructor of the object type to find.
   * @returns An array of found objects.
   */
  findAll<T extends object>(constructor: Constructor<T>): T[] {
    return this._core.findAll(constructor, this._predicate);
  }

  /**
   * Finds all tracked objects.
   */
  get all(): object[] {
    return this._core.findAll(undefined, this._predicate);
  }
}

export class RootObjectsView extends ObjectsView {
  private _allowedRootTypes: Constructor[] | undefined;

  constructor(core: ObjectSyncCore) {
    super(core, (info) => info.isRoot);
  }

  /**
   * Gets or sets the allowed root types that can be transmitted by a client. If not set, all types provided by sync agents will be allowed as root types.
   */
  get allowedRootTypesFromClient() {
    return this._allowedRootTypes ?? this.core.syncAgentProviders.all.map((p) => p.syncType);
  }
  set allowedRootTypesFromClient(types: Constructor[] | undefined) {
    this._allowedRootTypes = types;
  }

  /**
   * Checks if a type is allowed to be tracked as a root object when transmitted by a client. This checks if there is a sync agent provider for the type and if the type is included in the allowed root types (if specified).
   */
  isTypeFromClientAllowed(constructorOrTypeId: Constructor | string): boolean {
    const provider = this.core.syncAgentProviders.find(constructorOrTypeId);
    if (!provider) {
      return false;
    }
    if (this._allowedRootTypes === undefined) {
      return true;
    }
    return this._allowedRootTypes.includes(provider.syncType);
  }
}
