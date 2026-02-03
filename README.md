# simple-object-sync

Synchronize object state between host and client environments with fine-grained control over properties and methods. Supports multi-client scenarios and advanced array/object synchronization.

Can also be used to simply serialize an object tree for later deserialization.

**Note:** This library does not handle the connection or communication layer (such as transferring messages over ports, sockets, or other transport mechanisms). You are responsible for implementing the connection layer and for sending/receiving messages between host and client using your preferred method.

**Security Note:**
To prevent malicious or invalid data from being transferred, you must verify and validate all incoming and outgoing data yourself. Use the hooks provided by decorator functions (such as `canApply`, `canTrack`, `beforeSendToClient`, and `beforeExecuteOnClient`) to implement custom validation, filtering, and access control logic for your application.

An `ObjectSync` instance will only create or instantiate types registered in its `serializers` and `intrinsicSerializers` list. By default, all known types marked with `@syncObject` are allowed unless you restrict the configuration. This is not a strict security measure—if you need to limit which types can be synchronized and instantiated, you must explicitly control the contents of `serializers` and `intrinsicSerializers`.

`intrinsicSerializers` containss serializers to handle `Set`, `Array`, `Map` and `Object` types without complex serialization logic.

## Key API Features

- **Synchronize state between host and multiple clients:**

  Register multiple clients with the host. State changes are propagated to all connected clients.

- **Track changes to objects and properties:**

  Use decorators to mark properties for tracking.
  Changes are automatically detected and can be synchronized to clients.
  Only changes relevant for a client will be transmitted.

- **Call methods on clients:**

  Use decorators to methods for tracking.
  Those marked can be called from the host and the clients will execute them. Once execution is finished the host will know their results.

- **Decorator-based API:**
  - `@syncObject`: Marks a class as trackable and synchronizable.
  - `@syncProperty`: Marks a property for change tracking and synchronization. Supports hooks for value manipulation and permission checks.
  - `@syncMethod`: Marks a method for remote invocation and synchronization. Supports hooks for argument manipulation and permission checks.

- **Message-based communication:**

  The library generates messages for state changes and method calls. You must implement the transport layer to send/receive these messages between host and clients.

- **Array and observable array synchronization:**
  - `SyncableArray`: Synchronizes array values and mutations (push, splice, etc.) between host and client.
  - `SyncableObservableArray`: Extends `SyncableArray` with event support (`on`, `off`) for reacting to changes such as items being added or removed.

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
    beforeExecuteOnClient({ args, destinationClientConnection }) {
      // Example: modify arguments before execution on client
      args[0] = args[0] + destinationClientConnection.identity;

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
  identity: "host", // Unique identity for the host
  serializers: [SomeTrackableClass], // List of trackable types
});

// Register multiple clients with unique identities
const clients = [];
for (let i = 0; i < 3; i++) {
  const clientToken = hostSync.registerClient({ identity: "client" + i });
  clients.push(clientToken);
}
```

### Message exchange

The ObjectSync instance provides a method that handles and delegates everything needed to transfer messages from the host and to a client including the awaiting for the client replies and application of the messages sent by those clients:

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

The `exchangeMessagesAsync` supports specific `clients` with which it should exchange messages and an `errorHandler` with which you can react to errors throws while exchanging messages. It is also possible to filter incoming and outgoing messages with the help of the `clientMessageFilter`.

### Array Synchronization

Synchronize changes to arrays and observable arrays between host and client.

```typescript
import { SyncableArray } from "simple-object-sync";

// Host: Track a SyncableArray instance
const alpha = new SyncableArray<string>("alpha", "beta");
hostSync.track(alpha);

// Client: Find the synchronized array instance
const alphaClient = clientSync.findOne(SyncableArray<string>)!;
assert.deepStrictEqual(alpha, alphaClient); // Values are kept in sync
```

```typescript
import { SyncableObservableArray } from "simple-object-sync";

// Host: Track a SyncableObservableArray instance
const alpha = new SyncableObservableArray<string>("alpha", "beta");
hostSync.track(alpha);

// Client: Find the synchronized array instance
const alphaClient = clientSync.findOne(SyncableObservableArray<string>)!;

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

const arrayDispatcher = hostSync.getDispatcher(array)!;
arrayDispatcher.reportSplice();
```

### Custom Serializable Types

You can add custom serializers with varying complexity. Serializers work by generating multiple messages needed to construct and interact with instances of the type the serializer should handle.

The simplest form will generate a `create` message and apply this message when received. To further simplify the creation of serializers this library provides the `MakeSimpleTypeSerializer` helper method to create ready to use serializers for simple types:

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

import {MakeSimpleTypeSerializer } from "simple-object-sync";

const MySerializableClassSerializer = MakeSimpleTypeSerializer<MySerializableClass, number>({
  typeId: "MySerializableClass",
  type: MySerializableClass,
  serialize: (obj: MySerializableClass) => obj.value,
  deserialize: (data: any) => new MySerializableClass(data)
});

const hostSync = new ObjectSync({
  ...
  serializers: [MySerializableClassSerializer, ...], // Register the serializer
});
```

More complex serializers can be implemented by either extending the `TypeSerializer` or `ExtendedTypeSerializer` class:

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
import { ExtendedTypeSerializer, ObjectInfo } from "simple-object-sync";

type TInstance = MySerializableClass;
type TPayload = number;
const TYPE_ID = "MySerializableClass";

class MyMySerializableClassSerializer extends ExtendedTypeSerializer<TInstance, TPayload> {
  static canSerialize(instanceOrTypeId: TInstance | string): boolean {
    if (typeof instanceOrTypeId === "string") {
      return instanceOrTypeId === TYPE_ID;
    }
    return instanceOrTypId instanceof MySerializableClass;
  }

  public override onInstanceSet(createdByCreateObjectMessage: boolean): void {
    super.onInstanceSet(createdByCreateObjectMessage);

    this..instance.on("valueChanged", () => {
      this.hasPendingChanges = true; // Defined in the base class to help with detecting changes.
    });
  }

  getTypeId(clientToken: ClientToken) {
    return TYPE_ID;
  }

  onCreateMessageReceived(message: CreateObjectMessage<TPayload>, clientToken: ClientToken): void {
    this.instance = new MySerializableClass(message.data);
  }

  override onChangeMessageReceived(message: ChangeObjectMessage<TPayload>, clientToken: ClientToken): void {
    this.instance.theValue = message.data;
  }

  generateMessages(clientToken: ClientToken, isNewClientConnection: boolean): Message[] {
    if (isNewClientConnection) {
       const message: CreateObjectMessage<TPayload> = {
        type: "create",
        objectId: this.objectId,
        typeId: TYPE_ID,
        data: this.instance.theValue,
      };
      return [message];
    }
    else if (this.hasPendingChanges) {
      const message: ChangeObjectMessage<TPayload> = {
        type: "change",
        objectId: this.objectId,
        data: this.instance.theValue,
      };
      return [message];
    }

    return [];
  }
}
```

### Control property/method sync behavior

Use hooks like `clientTypeId`, `beforeSendToClient`, `canApply`, and `beforeExecuteOnClient` and more for fine-grained control over what gets synchronized and when.

You can change the type which will be reported to any client or simply disallow it to be created on the client:

```typescript
import { syncObject, nothing } from "simple-object-sync";

@syncObject({
  clientTypeId({instance, constructor, typeId, destinationClientConnection}) {
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
    beforeSendToClient({ instance, key, value, destinationClientConnection }) {
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
    canApply({ instance, key, sourceClientConnection }) {
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

    beforeExecuteOnClient({ instance, key, args, destinationClientConnection }) {
      // Modify arguments before execution on client
      args[0] = args[0] + destinationClientConnection.identity;

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
const dispatcher = hostObjectSync.getDispatcher(myHostObject);
const resultsByClient: Map<ClientToken, Promise<string>> = dispatcher.invoke("someMethod", someArgument);

...

// when the method that should be invoked has the promiseHandlingType of "await" or when the
// method that should be executed does not return a Promise the results are ready directly after the message exchange.
const clientResult = await resultsByClient.get(someClientConnection);
```

Methods can also be executed on a specific client set:

```typescript
const resultsByClient: Map<ClientToken, Promise<string>> = dispatcher.invoke([clientToken1, clientToken2], "someMethod", someArgument);
```

Or just on a single client:

```typescript
const dispatcher = hostObjectSync.getDispatcher(myHostObject);
const clientResult: Promise<string> = dispatcher.invoke(clientToken1, "someMethod", someArgument);
```

The result promises will automatically be rejected when the client prohibits it or when a client gets unregistered from your ObjectSync instance.

### Mock Communication Layer Example (using worker threads)

Below is a mock implementation of a communication layer using worker threads, inspired by the `worker.test.ts` and `worker.ts` files. This demonstrates how the host and client can exchange messages using a simple transport abstraction.

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
  serializers: [SomeTrackableClass]
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

This example abstracts the transport using worker threads, but you can adapt the pattern to any communication layer (e.g., sockets, web workers, etc.). The host sends messages to each client, and the client applies them and responds with his own messages.

## Simple reference stable serialization and storage

This library can also be used to store an object graph for later reuse:

```typescript
import { serializeValue, deserializeValue} from "simple-object-sync";

const testObject: Record<string, any> = {
  a: 1,
  b: "test",
  c: true,
  d: null,
  e: undefined,
  f: { nested: "value" },
  g: [1, 2, 3],
  h: new Map([
    ["key1", "value1"],
    ["key2", "value2"],
  ]),
  i: new Set([1, 2, 3]),
};
testObject.self = testObject;

const serialized = serializeValue(testObject);
const deserialized = deserializeValue(serialized)!;
```

## Testing

Run all tests:

```bash
npm test
```

## License

MIT
