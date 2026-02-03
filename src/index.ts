export {
  ObjectSync,
  type ObjectIdGeneratorSettings,
  type FinalizedObjectSyncSettings,
  type ObjectSyncSettings,
  type StandaloneSerializationSettings,
  serializeValue,
  deserializeValue,
  deserializeValueAsync,
} from "./objectSync/index.js";

export { syncMethod, syncObject, syncProperty, nothing, getTrackableTypeInfo, allSyncObjectTypes } from "./decorators/index.js";

export {
  type TypeSerializerConstructor,
  TypeSerializer,
  ExtendedTypeSerializer,
  type SetSerializer,
  type MapSerializer,
  type ObjectSerializer,
  type ArraySerializer,
  type SyncArraySerializer,
  type SyncObservableArraySerializer,
  SyncableArray,
  SyncableObservableArray,
  MakeSimpleTypeSerializer,
  type ISyncObjectDispatcher,
  type ISyncArrayDispatcher,
} from "./serialization/index.js";

export {
  type ChangeObjectMessage,
  type ClientToken,
  type ClientConnectionSettings,
  type CreateObjectMessage,
  type DeleteObjectMessage,
  type ExecuteObjectMessage,
  type ExecuteFinishedObjectMessage,
  type Message,
  EventEmitter,
  type IEventEmitter,
  type ObjectInfo,
  isChangeObjectMessage,
  isCreateObjectMessage,
  isDeleteObjectMessage,
  isExecuteFinishedObjectMessage,
  isExecuteObjectMessage,
  CreateMessageType,
  ChangeMessageType,
  DeleteMessageType,
  ExecuteMessageType,
  ExecuteFinishedMessageType,
} from "./shared/index.js";
