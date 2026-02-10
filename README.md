# simple-object-sync

Synchronize object state between host and client environments with fine-grained control over properties and methods.  
Supports multi-client scenarios and advanced array/object synchronization.

Can also be used to simply serialize an object tree for later deserialization.

**Communication layer note:**

This library does not handle the connection or communication layer (such as transferring messages over ports, sockets, or other transport mechanisms).  
You are responsible for implementing the connection layer and for sending/receiving messages between host and client using your preferred method.

## Key API Features

- **Synchronize state between host and multiple clients:**

  Register multiple clients with the host. State changes are propagated to all connected clients.

- **Track changes to objects and properties:**

  Use decorators to mark properties for tracking.  
  Changes are automatically detected and can be synchronized to clients.  
  Only changes relevant for a client will be transmitted.

- **Call methods on clients:**

  Use decorators to methods for tracking.  
  Those marked can be called from the host and the clients will execute them.  
  Once execution is finished the host will know their results.

- **Decorator-based API:**
  - `@syncAgent`: Automatically creates and registers SyncAgentProvider for a custom SyncProvider.
  - `@syncObject`: Marks a class as trackable and synchronizable.
  - `@syncProperty`: Marks a property for change tracking and synchronization. Supports hooks for value manipulation and permission checks.
  - `@syncMethod`: Marks a method for remote invocation and synchronization. Supports hooks for argument manipulation and permission checks.

- **Message-based communication:**

  The library generates messages for state changes and method calls.  
  You must implement the transport layer to send/receive these messages between host and clients.

- **Intrinsic type synchronization:**
  - `Error` and following subtypes will be synchronized (without mutations):
    - `EvalError`
    - `RangeError`
    - `ReferenceError`
    - `SyntaxError`
    - `TypeError`
    - `URIError`
    - `AggregateError`
  - `Set<TValue>`: Synchronizes `Set<TValue>` values but not mutations.
    - `SyncableSet<TValue>`: Supports mutations.
    - `SyncableObservableSet<TValue>`: Supports mutations and is an event emitter which reports `cleared`, `added` and `deleted` events.
  - `Array<TValue>`: Synchronizes `Array<TValue>` values but no mutations.
    - `SyncableArray<TValue>`: Supports mutations.
    - `SyncableObservableArray<TValue>`: Supports mutations and is an event emitter which reports `added` and `removed` events.
  - `Map<TKey, TValue>`: Synchronizes `Map<TKey, TValue>` values but no mutations.
    - `SyncableMap<TKey, TValue>`: Synchronizes `Map<TKey, TValue>` values and mutations.
    - `SyncableObservableMap<TKey, TValue>`: Supports mutations and is an event emitter which reports `cleared`, `added` and `deleted` events.

- **TypeScript support:**

  All API features are fully typed for safe and predictable usage in TypeScript projects.

## Installation

```bash
npm install simple-object-sync
```

## Usage

### Trackable Objects and Methods

```typescript
import { syncObject, syncProperty, syncMethod } from "simple-object-sync";

// Mark the class as trackable and synchronizable
@syncObject()
class SomeTrackableClass {
  // Track changes to this property and sync to clients
  @syncProperty()
  accessor value: number = 0;

  // Allow remote invocation of this method from clients
  @syncMethod({
    promiseHandlingType: "await", // Await the result before responding
    beforeExecuteOnClient({ args, destinationClientToken }) {
      // Example: modify arguments before execution on client
      args[0] = args[0] + destinationClientToken.identity;

      // Allow the execution, return false if you dont want that the client executes the method
      return true;
    },
  })
  someMethod(someArgument: string) {
    // In this sample we simply return the input argument
    return someArgument;
  }
}
```

### Host and Multi-Client Setup

```typescript
import { ObjectSync } from "simple-object-sync";

// Create the host instance and register trackable types
const hostSync = new ObjectSync({
  // Unique identity for the host
  identity: "host",
  // Optional list of syncAgents/types that should be supported
  syncAgents: [SomeTrackableClass],
});

// Register multiple clients with unique identities
const clients = [];
for (let i = 0; i < 3; i++) {
  const clientToken = hostSync.registerClient({ identity: "client" + i });
  clients.push(clientToken);
}
```

### Message exchange

The ObjectSync instance provides a method that handles and delegates everything needed to transfer messages from the host and to a client,  
including the awaiting for the client replies and application of the messages sent by those clients:

```typescript
await hostSync.exchangeMessagesAsync({
    async sendToClientAsync(clientToken, messages): Message[] {
     // Send the messages to your client (worker, eg.) that is associated with the target clientToken
     ...
     // The client should reply with the messages for the host
     ...
    },
  });
```

The `exchangeMessagesAsync` supports specific `clients` with which it should exchange messages and an `errorHandler` with which you can react to errors throws while exchanging messages.  
It is also possible to filter incoming and outgoing messages with the help of the `clientMessageFilter`.

### Array Synchronization

Synchronize changes to arrays and observable arrays between host and client.

```typescript
import { SyncableArray } from "simple-object-sync";

// Host: Track a SyncableArray instance
const alpha = new SyncableArray<string>("alpha", "beta");
hostSync.track(alpha);

// Client: Find the synchronized array instance
const alphaClient = clientSync.rootObjects.findOne(SyncableArray<string>)!;
assert.deepStrictEqual(alpha, alphaClient); // Values are kept in sync
```

```typescript
import { SyncableObservableArray } from "simple-object-sync";

// Host: Track a SyncableObservableArray instance
const alpha = new SyncableObservableArray<string>("alpha", "beta");
hostSync.track(alpha);

// Client: Find the synchronized array instance
const alphaClient = clientSync.rootObjects.findOne(SyncableObservableArray<string>)!;

// Listen for items being added
alphaClient.on("added", (itemsAdded: string[]) => {
  // handle added items
});

// Listen for items being removed
alphaClient.on("removed", (itemsRemoved: string[]) => {
  // handle removed items
});
```

#### Note:

The `SyncableObservableArray<T>` and `SyncableArray<T>` can be used like a normal `Array<T>`:

```typescript
const array: Array<string> = new SyncableArray<string>("alpha", "beta");
hostSync.track(array);

array[0] = "gamma";
array.push("delta");
```

You can also report changes to an normal tracked `Array<T>`:

```typescript
const array = ["alpha", "beta"];
hostSync.track(array);

array[0] = "gamma";
array.push("delta");

const arraySyncAgent = hostSync.getSyncAgent(array)!;
arraySyncAgent.reportSplice();
```

### Set and Map Synchronization

Like with an `SyncableArray<T>`, changes to a `Map<Key, Value>` and `Set<Value>` can also be tracked through the `SyncableMap<Key, Value>` and `SyncableSet<Value>` classes:

```typescript
import { SyncableMap, SyncableSet } from "simple-object-sync";

const map = new SyncableMap<string, number>([
  ["a", 1],
  ["b", 2],
  ["c", 3],
]);
hostSync.track(map);

const set = new SyncableSet<string>(["a", "b", "c"]);
hostSync.track(set);
```

### Custom SyncAgents (serializer, deserializer and state tracker)

You can add custom sync agent with varying complexity.  
Sync agents work by generating multiple messages needed to construct and interact with instances of the type the agent should handle.

The simplest form will generate a `create` message and apply this message when received.  
To further simplify the creation of agents this library provides the `createSimpleSyncAgentProvider` helper method to create ready to use agent and agent provider for simple types:

```typescript
class MySerializableClass {
  #myHiddenValue: number;

  constructor(value: number = 0) {
    this.#myHiddenValue = value;
  }

  get theValue(): number {
    return this.#myHiddenValue;
  }
}
...

import { createSimpleSyncAgentProvider } from "simple-object-sync";

const provider = createSimpleSyncAgentProvider<MySerializableClass, number>({
  typeId: "MySerializableClass",
  type: MySerializableClass,
  serialize: (obj: MySerializableClass) => obj.value,
  deserialize: (data: any) => new MySerializableClass(data)
});

const hostSync = new ObjectSync({
  ...
  // Register the agent provider
  types: [provider, ...],

  // You can also just register the type, the system will automatically grab the agent provider it created for a type
  types: [MySerializableClass, ...],
});
```

More complex agents can be implemented by either extending the `SyncAgent` or `ExtendedSyncAgent` class:

```typescript
import { EventEmitter } from "simple-object-sync";

type EventMap = {
  valueChanged(): void;
};
class MyClass extends EventEmitter<EventMap> {
  #myHiddenValue: number;

  constructor(value: number = 0) {
    super();
    this.#myHiddenValue = value;
  }

  get theValue(): number {
    return this.#myHiddenValue;
  }
  set theValue(value: number) {
    this.#myHiddenValue = value;

    // Emit a message to report changes.
    this.emit("valueChanged");
  }
}
```

```typescript
import { ExtendedSyncAgent, ObjectInfo, syncAgent, Message, ChangeObjectMessage, CreateObjectMessage } from "simple-object-sync";

const TYPE_ID = "MySerializableClass";

@syncAgent({
  typeId: TYPE_ID,
  type: MySerializableClass,
})
class MySerializableSyncAgent extends ExtendedSyncAgent<MySerializableClass> {
  constructor(objectInfo: ObjectInfo) {
    super(objectInfo);
  }

  public override getTypeId(clientToken: ClientToken) {
    // Here we could return a different type id based upon the client
    return TYPE_ID;
  }

  public override onInstanceSet(createdByCreateObjectMessage: boolean): void {
    super.onInstanceSet(createdByCreateObjectMessage);

    this.instance.on("valueChanged", () => {
      this.hasPendingChanges = true; // Defined in the base class to help with detecting changes.
    });
  }

  onCreateMessageReceived(message: CreateObjectMessage<number>, clientToken: ClientToken): void {
    this.instance = new MySerializableClass(message.data);
  }

  override onChangeMessageReceived(message: ChangeObjectMessage<number>, clientToken: ClientToken): void {
    this.instance.theValue = message.data;
  }

  generateMessages(clientToken: ClientToken, isNewClient: boolean): Message[] {
    if (isNewClient) return [this.createMessage("create", this.instance.theValue, clientToken)];
    else if (this.hasPendingChanges) return [this.createMessage("change", this.instance.theValue)];
    return [];
  }
}
```

The `@syncAgent` decorator does only create a `SyncAgentProvider` instance witht he provided settings. You can extend from the `SyncAgentProvider` class and create custom compatibility check methods if you need.

#### Transfering references within a SyncAgent

The library contains a memory management system which relies on the knowledge if any references are used and by which client it is used.  
When you want to transfer reference types you must serialize and deserialize those values into a form that the library understands,  
also you need to keep track of the reference usage.

The library and the base SyncAgents provide methods to do just that.

Generating messages for a client (`generateMessages`):

- serialize the value (primitive or reference) by using the `SyncAgent.serializeValue(value: any, clientToken: ClientToken): SerializedValue` method.
- mark the reference or primitive as in use with the `SyncAgent.storeReference(settings: ReferenceStorageSettings): IDisposable` method.

```typescript
// In this example we assume that the instance is an Array
generateMessages(clientToken: ClientToken, isNewClient: boolean): Message[] {
  ...

  const createPayload: SerializedValue[] = [];

  for (let index = 0; index < this.instance.length; index++) {
    const value = this.instance[index];
    // we mark the value as in use for this clientToken and for this index
    this.storeReference({ value, key: index, clientToken });
    // Then we serialize the value to allow the system to transfer whole objects/references
    const serializedValue = this.serializeValue(value, clientToken);
    createPayload.push(serializedValue);
  }


  const createMessage = this.createMessage("create", createPayload, clientToken);

  ...
}
```

If you store an other reference with the same `clientToken` and `key` the library at a later time (for example to emit a `change` message) the library can handle appropiate `delete` messages to affected clients.

You can clear all stored references by `key` or `clientToken` too, which can be useful when a change would clear everything:

- `SyncAgent.clearStoredReferencesWithKey(key: any)`
- `SyncAgent.clearStoredReferencesWithClientToken(clientToken: ClientToken)`

When applying those messages we do not need to store a reference to it,  
but we must deserialize the transferred serialized value back to a normal usable value, by doing this the library ensures that transferred references will be used or created.

- deserialize the serialized value by using the `SyncAgent.deserializeValue(value: SerializedValue, clientToken: ClientToken)` method.

```typescript
type TCreatePayload = SerializedValue[];

...

onCreateMessageReceived(createMessage: CreateObjectMessage<TCreatePayload>, clientToken: ClientToken) {
  // Always create an empty instance, the library can make use of it while we fill it
  // For example when deserializing circular references.
  // If we would only create the instance after deserialization, we would not be able to deserialize circular references.
  this.instance = [];

  const deserializedValues = createMessage.data.map((serializedValue) => this.deserializeValue(serializedValue, clientToken));
  this.instance.push(...deserializedValues);
}
```

### Control property/method sync behavior

Use hooks like `clientTypeId`, `beforeSendToClient`, `canApply`, and `beforeExecuteOnClient` and more for fine-grained control over what gets synchronized and when.

You can change the type which will be reported to any client or simply disallow it to be created on the client:

```typescript
import { syncObject, nothing } from "simple-object-sync";

@syncObject({
  clientTypeId({instance, constructor, typeId, destinationClientToken}) {
    // Client should receive a different type than this:
    return OtherTrackableType; // ot the TypeId string of an other type like: "TheTypeIdOfSomethingElse"

    // The client should receive the object without any type changes
    return typeId;

    // The client should receive nothing, no object should be sent to the client
    return nothing;
  }

  // it is also possible to just provide the type without a function:
  clientTypeId: OtherTrackableType
})
class MyTrackableClass {
  ...
}
```

You can dynamically restrict if a property should be tracked or applied for a client or the value sent to the client:

```typescript
import { syncObject, nothing, syncProperty } from "simple-object-sync";

@syncObject()
class MyTrackableClass {
  @syncProperty({
    beforeSendToClient({ instance, key, value, destinationClientToken }) {
      // Prevent changes from beeing sent to the client
      return nothing;

      // Manipulate the value sent to the client:
      return value + value;

      // Or leave it as is:
      return value;
    },
    canTrack({ instance, key, info }) {
      const identity = info.host.identity; // Use this to retrive the identity of the ObjectSync object which wants to track this

      // Allow tracking:
      return true;

      // Or disallow it:
      return false;
    },
    canApply({ instance, key, sourceClientToken }) {
      // Prevents the client from accepting the value
      return false;

      // Or allow it:
      return true;
    },
  })
  accessor value: number = 0;
}
```

Its also possible to statically set if an property or method should be tracked and/or changes applied:

```typescript
import { syncObject, syncProperty } from "simple-object-sync";

@syncObject()
class MyTrackableClass {
  @syncProperty({
    // Changes are tracked and applied (thats the default).
    mode: "trackAndApply"

    // Changes are only tracked, not applied.
    mode: "trackOnly"

    // Changes are only applied, not tracked.
    mode: "applyOnly"

    // Changes are neither tracked nor applied.
    mode: "none"
  })
  accessor value: number = 0;
}
```

It is also possible to fine tune the method execution:

```typescript
import { syncObject, syncMethod } from "simple-object-sync";

@syncObject()
class MyTrackableClass {
  // Allow remote invocation of this method from clients
  @syncMethod({
    // Report completion when finished and does not wait before finishing to sync message exchanges (This is the default)
    promiseHandlingType: "normal",

    // Await the result before finishing to sync message exchanges
    promiseHandlingType: "await",

    beforeExecuteOnClient({ instance, key, args, destinationClientToken }) {
      // Modify arguments before execution on client
      args[0] = args[0] + destinationClientToken.identity;

      // Allow the execution
      return true;

      // Prevent the execution
      return false;
    },
  })
  someMethod(someArgument: string): string {
    return someArgument;
  }
}
```

This is how to execute a method on all currently connected clients:

```typescript
const syncAgent = hostObjectSync.getSyncAgent(myHostObject);
const resultsByClient: Map<ClientToken, Promise<string>> = syncAgent.invoke("someMethod", someArgument);

...

// when the method that should be invoked has the promiseHandlingType of "await" or when the
// method that should be executed does not return a Promise the results are ready directly after the message exchange.
const clientResult = await resultsByClient.get(someClientToken);
```

Methods can also be executed on a specific client set:

```typescript
const resultsByClient: Map<ClientToken, Promise<string>> = syncAgent.invoke([clientToken1, clientToken2], "someMethod", someArgument);
```

Or just on a single client:

```typescript
const syncAgent = hostObjectSync.getSyncAgent(myHostObject);
const clientResult: Promise<string> = syncAgent.invoke(clientToken1, "someMethod", someArgument);
```

The result promises will automatically be rejected when the client prohibits it or when a client gets unregistered from your ObjectSync instance.

### Mock Communication Layer Example (using worker threads)

Below is a mock implementation of a communication layer using worker threads, inspired by the `worker.test.ts` and `worker.ts` files.  
This demonstrates how the host and client can exchange messages using a simple transport abstraction.

#### Host Side (spawns workers and exchanges messages)

```typescript
import { Worker } from "node:worker_threads";
import { ObjectSync, Message } from "simple-object-sync";

// Helper function which creates a client with a worker and registers the client to the provided host.
function createWorkerClient(hostSync, identity) {
  const worker = new Worker("./worker.js");
  const clientToken = hostSync.registerClient({ identity });

  const client = {
    clientToken,
    terminate() {
      hostSync.removeClient(clientToken);
      worker.terminate();
    },
    sendAndRequestMessagesAsync(messages: Message[]) {
      return new Promise<Message[]>((resolve) => {
        worker.once("message", resolve);
        worker.postMessage(messages);
      });
    },
  };

  return client;
}

// Creating and registering clients:
const clients = [];
clients.push(createWorkerClient(hostSync, "someClient"));
clients.push(createWorkerClient(hostSync, "someOtherClient"));

...

// Exchanging messages/updates
await hostSync.exchangeMessagesAsync({
  sendToClientAsync(clientToken, messages) {
    const client = clients.find((c) => c.clientToken === clientToken);

    // Send messages to the client and await the response
    return client.sendAndRequestMessagesAsync(messages);
  },
});

...

// Cleanup
clients.forEach((c) => c.terminate());
```

#### Client Side (worker.js)

```typescript
import { parentPort } from "worker_threads";
import { ObjectSync, Message } from "simple-object-sync";

...

const clientSync = new ObjectSync({
  identity: "client",
  types: [SomeTrackableClass]
});
const clientTokenFromHost = clientSync.registerClient({ identity: "host" });

parentPort.on("message", async (messages: Message[]) => {
  // Apply the changes which the host has sent
  await clientSync.applyMessagesAsync(messages, clientTokenFromHost);

  // Retrive the messagesthis client may have for our host
  const replyMessages = clientSync.getMessages(clientTokenFromHost);

  // call back to the host with our messages
  parentPort.postMessage(replyMessages);
});
```

This example abstracts the transport using worker threads, but you can adapt the pattern to any communication layer (e.g., sockets, web workers, etc.).  
The host sends messages to each client, and the client applies them and responds with his own messages.

## Memory Management

An ObjectSync instance will keep track of which client is using a reference. When a client is no longer using a reference the default behavior is to send a `delete` message for the reference to the client. This behavior may be problematic when the client stores the reference in an unsynchronized part.

For example:

#### Host:

```typescript
const alpha = Alpha();
const beta = new Beta();
alpha.betaToTransfer = beta;

hostSync.track(alpha);

// 1. An instance of Alpha and Beta will be created on the clients.
await exchangeMessagesWithClients();

// beta still exists after this, but is no longer used
alpha.betaToTransfer = null;

// 2. As beta is no longer used the previousely created Beta instance will be marked as deleted
// and clients receive the message to forgot about it.
await exchangeMessagesWithClients();

// retransfer beta
alpha.betaToTransfer = beta;

// 3. The clients receive a new create message and will create a new instance
await exchangeMessagesWithClients();
```

#### Client:

```typescript
// 1. We should receive the create messages for Alpha and Beta
await receiveMessages();
const alpha = hostSync.rootObjects.findOne(Alpha);
const originalBeta = alpha.betaToTransfer;

// 2. We should receive the delete messages for the Beta instance and
// a change message to let us know about the fact that alpha.betaToTransfer is now null
await receiveMessages();
// This should be null, originalBeta has still the old value though
let betaNow = alpha.betaToTransfer;

// 3. We should receive the create messages for the new Beta instance
await receiveMessages();
// betaNow will have a new instance value
betaNow = alpha.betaToTransfer;

console.log(originalBeta === betaNow); // false
```

To prevent this, you have three options:

1. Keep the reference known to the client by storing it somewhere which will be synchronized with the client.
2. Pin the reference by explicitely tracking it with the `track` method.  
   This will also send the reference to the client even when it is not used by any other element.
3. Set the `memoryManagementMode` of the `ObjectSync` instance when you create it, to `weak`.  
   Only when the instance is garbage collected (`FinalizationRegistry`), will a `delete` message be emitted, for affected clients.

#### Host:

```typescript
const hostSync = new ObjectSync({
  ...
  memoryManagementMode: "weak" // <- This!
})

const alpha = Alpha();
let beta = new Beta();
alpha.betaToTransfer = beta;

hostSync.track(alpha);

// 1. An instance of Alpha and Beta will be created on the clients.
await exchangeMessagesWithClients();

// beta still exists after this, but is no longer used
alpha.betaToTransfer = null;

// 2. The clients will only receive a change message for alpha.betaToTransfer = null
await exchangeMessagesWithClients();

// reassign beta
alpha.betaToTransfer = beta;

// 3. The clients receive a change message and will reuse their stored value for beta
await exchangeMessagesWithClients();

// 4. Remove all usages of beta, so that the garbage collector may free the instance of Beta at a later time
alpha.betaToTransfer = null;
beta = null;
await exchangeMessagesWithClients();

...

// 5. Sometimes later after the GC collected the instance of beta the clients receive a delete message.
await exchangeMessagesWithClients();
```

#### Client:

```typescript
// 1. We should receive the create messages for Alpha and Beta
await receiveMessages();
const alpha = hostSync.rootObjects.findOne(Alpha);
const originalBeta = alpha.betaToTransfer;

// 2. We should only receive a change message to let us know about the fact that alpha.betaToTransfer is now null
await receiveMessages();

// This should be null, originalBeta has still the old value though
let betaNow = alpha.betaToTransfer;

// 3. We should receive the change message for alpha.betaToTransfer
await receiveMessages();
// betaNow will have a new value
betaNow = alpha.betaToTransfer;

console.log(originalBeta === betaNow); // true

// 4. We should receive the change message for alpha.betaToTransfer, it is now null again
// but no delete message should be received for now
await receiveMessages();
// betaNow will be again null
betaNow = alpha.betaToTransfer;

...

// 5. Sometime later we should receive the delete message from the host to let
// us know that beta is now deleted/garbage collected
await receiveMessages();
```

With this the client can send the instance back to the host,  
the host will automatically revive the reference as long as it is not garbage collected.

## Simple reference stable serialization and storage

This library can also be used to store an object graph for later reuse:

```typescript
import { serializeValue, deserializeValue } from "simple-object-sync";

const testObject: Record<string, any> = {
  someString: "test",
  anObject: { value: "value" },
  anArray: [1, 2, 3],
  someMap: new Map([
    ["key1", "value1"],
    ["key2", "value2"],
  ]),
  someSet: new Set([1, 2, 3]),
};
// Add a cyclic reference to demonstrate that this works too
testObject.self = testObject;

const serialized = serializeValue(testObject);
const deserialized = deserializeValue(serialized)!;

console.log(deserialized === testObject); // false, deserialization creates new instanced
console.log(deserialized.anObject === testObject.anObject); // false, the same as above

console.log(deserialized.anObject.value === testObject.anObject.value); // true
console.log(deserialized.self === deserialized); // true, cyclic references will work
console.log(deserialized.someMap.get("key2") === testObject.someMap.get("key2")); // true
console.log(deserialized.someSet.has(2)); // true
```

## ObjectSync Class Overview

The `ObjectSync` class is the core of the library. It manages object tracking, synchronization, message exchange, and client management between host and clients.

**Constructor:**

Creates a new sync manager with the provided settings:

- `new ObjectSync(settings: ObjectSyncSettings)`

**Common Methods:**

Registers a new client. Use a string or settings object:

- `registerClient(identity: string | ClientConnectionSettings): ClientToken`  
  The identity of a registered client is available in the generated ClientToken.  
  You can use this in several sync\* decorator hooks for filtering.
  The identity will not be used for anything else.

Removes a client and cleans up its state:

- `removeClient(clientToken: ClientToken): void`

Tracks an object for synchronization. Returns a disposable to untrack and receive more information about the state of the tracked object:

- `track(instance: object, objectId?: string): TrackedObjectDisposable`

  ```typescript
  // Host:
  const someInstance = new SomeClass();
  const trackedDisposable = hostSync.track(someInstance);
  console.log(trackedDisposable.objectId); // 'host-1' for example
  console.log(trackedDisposable.instance === someInstance); // true

  trackedDisposable.dispose(); // someInstance is now no longer pinned and clients will receive delete messages at a later time
  ```

Stops tracking a root object:

- `untrack(instance: object): boolean`

Gets messages to send to clients:

- `getMessages(clearNonClientStates: boolean = true): Map<ClientToken, Message[]>`
- `getMessages(clientTokens: ClientToken[], clearNonClientStates: boolean = true): Map<ClientToken, Message[]>`
- `getMessages(clientToken: ClientToken, clearNonClientStates: boolean = true): Message[]`

Applies messages received from a client:

- `applyMessagesAsync(messages: Message[], clientToken: ClientToken): Promise<void>`

Handles message exchange with clients, including filtering and error handling:

- `exchangeMessagesAsync(settings: ExchangeMessagesSettings): Promise<void>`

Finds one or more tracked object by type or ID:

- `allObjects.findOne<T>(constructorOrObjectId: Constructor<T> | string, objectId?: string): T | undefined`
- `rootObjects.findOne<T>(constructorOrObjectId: Constructor<T> | string, objectId?: string): T | undefined`

  ```typescript
  // Host:
  const someInstance = new SomeClass();
  someInstance.other = new OtherClass();
  hostSync.track(someInstance, "wellKnownName");

  // Client:
  const someInstance: SomeClass | undefined = clientSync.rootObjects.findOne<SomeClass>("wellKnownName");
  const otherInstance: OtherClass | undefined = clientSync.rootObjects.findOne(OtherClass);
  console.log(someInstance.other === otherInstance); // true
  ```

- `allObjects.findAll<T>(constructor: Constructor<T>): T[]`
- `rootObjects.findAll<T>(constructor: Constructor<T>): T[]`

  ```typescript
  // Host:
  const someInstance = new SomeClass();
  const someOtherInstance = new SomeClass();
  hostSync.track(someInstance);
  hostSync.track(someOtherInstance);

  // Client:
  const someInstances: SomeClass[] = clientSync.rootObjects.findAll<SomeClass>(SomeClass);
  console.log(someInstances.length); // 2
  ```

Gets the used sync agent for a tracked object.  
When the object is not yet tracked it will be inexplicitely tracked as non root object.
You can specify a sync agent type for custom or advanced usage:

- `getSyncAgent(instance: Array<T>): IArraySyncAgent<T> | null`
- `getSyncAgent(instance: Set<T>): ISetSyncAgent<T> | null`
- `getSyncAgent(instance: Map<K, V>): IMapSyncAgent<K,V> | null`
- `getSyncAgent(instance: object): ISyncObjectSyncAgent | null`
- `getSyncAgent<TSyncAgent extends ISyncAgent>(instance: object): TSyncAgent | null`

  The method is generic and allows you to provide a syncAgent type:

  ```typescript
  const syncAgent = sync.getSyncAgent<IMyCustomSyncAgent>(myObject);
  ```

  This enables type-safe access to custom sync agents, not just the default sync agents. Use this when your tracked object has a specialized sync agent interface.

**Properties:**

- `identity`: The identity of this sync instance.
- `allObjects`: All currently tracked objects.
- `rootObjects`: All currently tracked root objects (from the host or client).
- `registeredClientTokens`: All registered client tokens.

**Example:**

```typescript
import { ObjectSync } from "simple-object-sync";

const sync = new ObjectSync({ identity: "host" });

const clientToken = sync.registerClient("client1");

const obj = { foo: 123 };
sync.track(obj);

const messages = sync.getMessages(clientToken);
// Send messages to client, receive reply, then:
sync.applyMessagesAsync(replyMessages, clientToken);
```

**Tips:**

- Use `track` for root objects you want to keep synchronized and alive.
- Use `getSyncAgent` to invoke methods or report changes on tracked objects.
- Use `exchangeMessagesAsync` for full message exchange cycles with clients.

The `ObjectSyncSettings` object is used to configure your `ObjectSync` instance.  
It determines how objects are tracked, serialized, and synchronized between host and clients.

**Required:**

- `identity`: A unique string identifying this sync instance (e.g., `"host"`, `"client1"`).  
  The identify will only be used to create objectIds when no custom objectId generator is specified

**Optional:**

- `types`: An array of classes or `SyncAgentProvider` instances for custom types you want to synchronize. If omitted, all available types are used.
- `intrinsics`: An array of type or `SyncAgentProvide` instances for built-in types (Array, Map, Set, Object). Defaults are provided if omitted.
- `objectIdGeneratorSettings`: Controls how object IDs are generated. Use a custom function or a prefix string (Defaults to use the `identity` as prefix string).
- `arrayChangeSetMode`: `"trackSplices"` (for efficient small changes) or `"compareStates"` (for efficient large changes). Defaults to `"compareStates"`.
- `memoryManagementMode`: `"weak"` (objects deleted when garbage collected) or `"byClient"` (objects deleted when no client uses them). Defaults to `"byClient"`.

**Example:**

```typescript
import { ObjectSync } from "simple-object-sync";
import { MyCustomClass } from "./myCustomClass";

const sync = new ObjectSync({
  identity: "host",
  types: [MyCustomClass], // Restrict to custom type only
  arrayChangeSetMode: "trackSplices", // Use splice tracking for arrays
  memoryManagementMode: "weak", // Use weak memory management
  objectIdGeneratorSettings: { prefix: "host" }, // Custom ID prefix
});
```

**Tips:**

- Use `types` and `intrinsics` to restrict which types can be synchronized.
- Set `memoryManagementMode` to `"weak"` for reference stability and less aggressive deletion.
- Adjust `arrayChangeSetMode` for your array mutation patterns.

## Security

To prevent malicious or invalid data from being transferred, you must verify and validate all incoming and outgoing data.  
Use the hooks provided by decorator functions (such as `canApply`, `canTrack`, `beforeSendToClient`, and `beforeExecuteOnClient`) to implement custom validation, filtering, and access control logic for your application.

An `ObjectSync` instance will only create or instantiate types registered in its `types` and `intrinsics` list.  
By default, all known types marked with `@syncObject` are allowed unless you restrict the configuration.  

If you need to limit which types can be synchronized and instantiated, you must explicitly control the contents of `types` and `intrinsics`.  
`intrinsics` contains everything to handle `Set`, `Array`, `Map`, `Object` and `Error` types.

You can also specify which types are acceptable for each `syncProperty` and `syncMethod`, when the receiver receives a not supported type, an exception will be thrown at the receiver while applying the messages. You should consider the receiver as unusable in those cases.

```typescript
import { ObjectSync } from "simple-object-sync";

@syncObject({})
class MyClass {
  @syncProperty({
    allowedTypesFromSender: [Number, MyOtherClass, null],
  })
  accessor value: number | MyOtherClass | null = 0;

  @syncProperty({
    allowedTypesFromSender: [Number, MyOtherClass, null],
  })
  accessor value: number | MyOtherClass | null = 0;

  @syncMethod({
    allowedParameterTypesFromSender: [
      [Number],
      [SubTrackable, null]
    ],
    allowedRejectionTypesFromSender: [Error, String],
    allowedReturnTypesFromSender: [Number],
  })
  myMethod(value: number, someData: MyOtherClass | null): Promise<number> {
    throw new MyForbiddenErrorType(); // The invoker should throw an error as MyForbiddenErrorType is not allowed
  }
}

...

const instance = new MyClass();
instance.value = new MyForbiddenClass() as any; // The client will throw an error when receiving this

sync.track(instance);

const syncAgent = sync.getSyncAgent(instance);
const argument0 = "i am a string and forbidden";
const argument1 = new MyForbiddenClass();
syncAgent.invoke("myMethod",
  argument0, // The client expects a number, but we send a string
  argument1 // The client expects null or an instance of MyOtherClass
);
```

You can restrict which tracked objects the client may receive, you can restrict this in the ObjectSyncSettings or at a later time by changing the `ObjectSync.rootObjects.allowedRootTypesFromClient` value:

```typescript
import { ObjectSync } from "simple-object-sync";

const sync = new ObjectSync({
  ...
  allowedRootTypesFromClient: [MyClass]
});

...

// no longer allow to receive any root types, doing so will throw an exception
// existing root objects are unaffected
sync.rootObjects.allowedRootTypesFromClient = [];
```

Most intrinsic types allow to limit the types allowed from senders to be limited by using the `SyncAgent` from them.

```typescript
const arraySyncAgent = sync.getSyncAgent(myArray);
arraySyncAgent.allowedTypesFromSender = [...];
```

```typescript
const setSyncAgent = sync.getSyncAgent(mySet);
setSyncAgent.allowedTypesFromSender = [...];
```

```typescript
const mapSyncAgent = sync.getSyncAgent(myMap);
mapSyncAgent.allowedKeyTypesFromSender = [...];
mapSyncAgent.allowedValueTypesFromSender = [...];
```

You can use it in combination with the `@syncProperty` decorator and the `afterValueChanged` property which will be called every time the value chnages:

```typescript
@syncObject({})
class MyClass {
  @syncProperty({
    allowedTypesFromSender: [Array],
    afterValueChanged({ value, syncAgent }) {
      const arraySyncAgent = syncAgent as IArraySyncAgent;
      if (!arraySyncAgent.allowedTypesFromSender) {
        arraySyncAgent.allowedTypesFromSender = [MyClass];
      }
    },
  })
  accessor value: Array<MyClass> = [];
}
```

Or with events send from the ObjectSync instance:

```typescript
sync.on("tracked", (instance: object, syncAgent: ISyncAgent) => {
  if (instance instanceof Array) {
    (syncAgent as IArraySyncAgent).allowedTypesFromSender = [MyClass];
  }
});
```

## Testing

Run all tests:

```bash
npm test
```

## License

MIT
