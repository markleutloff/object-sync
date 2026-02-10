import { ClientToken, Constructor, Message } from "../shared/index.js";
import { SyncAgentProvider } from "../syncAgents/index.js";

export type MemoryManagementMode = "weak" | "byClient";
export type ArrayChangeSetMode = "trackSplices" | "compareStates";

export type ExchangeMessagesSettings = {
  /**
   * Optional function to handle errors that occur during message exchange.
   * @param clientToken The client connection where the error occurred.
   * @param error The error that occurred.
   */
  errorHandler?: (clientToken: ClientToken, error: any) => void;

  /**
   * Optional function to filter messages sent to or received from clients.
   * Warning: Using this filter may lead to inconsistent states between server and clients if messages are blocked.
   * You can use it to implement custom logic, such as ignoring certain messages for specific clients.
   * @param clientToken The client connection involved in the message exchange.
   * @param message The message being sent or received.
   * @param isIncoming True if the message is incoming to the server, false if outgoing.
   * @returns True to allow the message, false to block it.
   */
  clientMessageFilter?: (clientToken: ClientToken, message: Message, isIncoming: boolean) => boolean;

  /**
   * Clients to exchange messages with. If not provided, messages will be exchanged with all registered clients.
   */
  clients?: ClientToken[];
} & (
  | {
      /**
       * Function to send messages to a single client and receive client messages back as results.
       * @param clientToken The client connection to send messages to.
       * @param messages The messages to send to the client.
       * @returns A promise that resolves to the messages received from the client.
       */
      sendToClientAsync: (clientToken: ClientToken, messages: Message[]) => Promise<Message[]>;
    }
  | {
      /**
       * Function to send messages to multiple clients and receive client messages back as results.
       * @param messagesByClientToken A map of client connections to messages to send.
       * @returns A promise that resolves to a map of client connections to messages received from the clients.
       */
      sendToClientsAsync: (messagesByClientToken: Map<ClientToken, Message[]>) => Promise<Map<ClientToken, Message[]>>;
    }
);

export type ObjectIdGeneratorSettings =
  | {
      /**
       * Function to generate an object ID..
       * @param value
       */
      generateId(value?: object): string;
    }
  | {
      /**
       * Prefix to use for generated object IDs.
       */
      prefix: string;
    };

export type FinalizedObjectSyncSettings = {
  identity: string;
  objectIdGeneratorSettings: ObjectIdGeneratorSettings;
  arrayChangeSetMode: ArrayChangeSetMode;
  memoryManagementMode: MemoryManagementMode;
};

export type ObjectSyncSettings = {
  /**
   * Identity of this ObjectSync instance (e.g., "host" or "client1").
   */
  identity: string;

  /**
   * Type sync agents to use for serializing and deserializing property values during synchronization.
   * Can either be provided as an array of type sync agents or constructors of SyncObject types.
   * When constructors are provided, the corresponding internal TypeSyncAgent will be used.
   * When not provided, all registered types and sync agents will be used.
   */
  types?: (SyncAgentProvider | Constructor)[];

  /**
   * Intrinsic type sync agents to use for serializing and deserializing base types (Array, Map, Set, Object) during synchronization.
   * Can be provided as an array of type sync agents.
   * When not provided, default intrinsic type sync agents will be used.
   */
  intrinsics?: (SyncAgentProvider | Constructor)[];

  /**
   * Settings for generating object IDs.
   * When not provided, a default generator with the identity as prefix will be used (eg: "host-1").
   */
  objectIdGeneratorSettings?: ObjectIdGeneratorSettings;

  /**
   * Defines how array changes are tracked and serialized.
   * - "trackSplices": Uses splice instructions to record changes. More efficient for small changes. May transfer data which will be removed with a later splice.
   * - "compareStates": gathers splice data by comparing the old array state to the new array state. More efficient for large changes. (Default)
   */
  arrayChangeSetMode?: ArrayChangeSetMode;

  /**
   * Specifies the memory management mode the ObjectSync instance should use.
   * "weak": Uses WeakRefs to track object lifetimes. Delete messages will be sent when objects are garbage collected.
   * "byClient" (default): Delete messages will be sent when objects are no longer used by a connected client.
   */
  memoryManagementMode?: MemoryManagementMode;

  /**
   * Optional list of types which the sender may send to this ObjectSync instance as root objects. This is a security measure to prevent clients from sending unexpected types which may be used to cause issues on the receiving end (e.g., by sending very large objects or objects with getters that execute expensive code). If not set, all types provided by sync agents will be allowed as root types.
   */
  allowedRootTypesFromClient?: Constructor[];
};
