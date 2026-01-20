# simple-object-sync

Synchronize object state between host and client environments with fine-grained control over properties and methods. Supports multi-client scenarios and advanced array/object synchronization.

**Note:** This library does not handle the connection or communication layer (such as transferring messages over ports, sockets, or other transport mechanisms). You are responsible for implementing the connection layer and for sending/receiving messages between host and client using your preferred method.

**Security Note:**
To prevent malicious or invalid data from being transferred, you must verify and validate all incoming and outgoing data yourself. Use the hooks provided by decorator functions (such as `canApply`, `canTrack`, `beforeSendToClient`, and `beforeExecuteOnClient`) to implement custom validation, filtering, and access control logic for your application.

An `ObjectSync` instance will only create or instantiate types registered in its `typeGenerators` list. By default, all known types marked with `@syncObject` are allowed unless you restrict the configuration. This is not a strict security measure—if you need to limit which types can be synchronized and instantiated, you must explicitly control the contents of `typeGenerators`.

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

## Usage Examples

### Trackable Objects and Methods

```typescript
import { syncObject, syncProperty, syncMethod } from "simple-object-sync";

// Mark the class as trackable and synchronizable
@syncObject()
class SomeTrackableClass {
  // Track changes to this property and sync to clients
  @syncProperty() accessor value: number = 0;

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
  invoke(someArgument: string) {
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
  typeGenerators: [SomeTrackableClass], // List of trackable types
});

// Register multiple clients with unique identities
const clients = [];
for (let i = 0; i < 3; i++) {
  const clientToken = hostSync.registerClient({ identity: "client" + i });
  clients.push(clientToken);
}
```

### Array Synchronization

Synchronize changes to arrays and observable arrays between host and client.

```typescript
import { SyncableArray } from "simple-object-sync";

// Host: Track a SyncableArray instance
const alpha = new SyncableArray<string>(["alpha", "beta"]);
hostSync.track(alpha);

// Client: Find the synchronized array instance
const alphaClient = clientSync.findObjectOfType(SyncableArray<string>)!;
assert.deepStrictEqual(alpha.value, alphaClient.value); // Values are kept in sync
```

```typescript
import { SyncableObservableArray } from "simple-object-sync";

// Host: Track a SyncableObservableArray instance
const alpha = new SyncableObservableArray<string>(["alpha", "beta"]);
hostSync.track(alpha);

// Client: Find the synchronized array instance
const alphaClient = clientSync.findObjectOfType(SyncableObservableArray<string>)!;

// Listen for items being added
alphaClient.on("added", (items) => {
  // handle added items
});

// Listen for items being removed
alphaClient.on("removed", (items) => {
  // handle removed items
});
```

### Custom Serializable Types

You can create custom serializable types and register serializers/deserializers for them. These types will not be tracked by the system, but can be serialized and deserialized for transfer between host and client. This is useful for handling data structures or classes that do not require change tracking but need to be sent across the connection.

Serializers/deserializers can be implemented in different ways, such as providing a `serialize` function to convert an object to plain data, and a `deserialize` function to reconstruct the object from data.
Alternatively one can ignore the `serialize` and `deserialize`, in this case the constructor of the type will be used to deserialize and instance.toValue() or instance.toJSON() will be used to serialize the instance.

Register your custom serializers in the `typeSerializers` option when creating an ObjectSync instance.

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

const mySerializableClassSerializer = {
  typeId: "MySerializableClass",
  type: MySerializableClass,
  serialize: (instance) => {
    return {
      value: instance.theValue
    };
  },
  deserialize: (data) => new MySerializableClass(data.value),
};

const hostSync = new ObjectSync({
  ...
  typeSerializers: [mySerializableClassSerializer], // Register the serializer
});
```

Some serializers are automatically provided, those are called nativeTypeSerializers in this library.

This are the native serializers automatically provided:

- Object
  ```typescript
  { foo: "bar", hello: "world", someTrackableValue: bla }
  ```
- Array - Beware: changes will be fully transmitted, use the provided SyncableArray class if you do not want this
  ```typescript
  ["hello", 123, false, true, someTrackableValue];
  ```
- Map
  ```typescript
  const myMap = new Map<string, any>();
  myMap.add("first", 1234);
  myMap.add("second", true);
  myMap.add("third", someTrackableValue);
  ```
- Set
  ```typescript
  const mySet = new Set<any>();
  myMap.set(1234);
  myMap.set(true);
  myMap.set(someTrackableValue);
  ```

All native serializers will look no further than the first level, so you cant put an object that contains a tracked value inside any of those.

In the case that this is not what is wanted, one can provide a list of native serializers when creating any ObjectSync instance:

```typescript
import { ObjectSync, nativeObjectSerializer, nativeArraySerializer, nativeSetSerializer, nativeTypeSerializers } from "simple-object-sync";

const hostSync = new ObjectSync({
  ...
  // specify it exactly
  nativeTypeSerializers: [nativeObjectSerializer, nativeArraySerializer],
  // or remove the unwanted ones
  nativeTypeSerializers: nativeTypeSerializers.filter(serializer => serializer !== nativeSetSerializer),
});
```

### Control property/method sync behavior

Use hooks like `beforeSendToClient`, `canApply`, and `beforeExecuteOnClient` for fine-grained control over what gets synchronized and when.

You can change the type which will be reported to any client or simply disallow it to be created on the client:

```typescript
import { syncObject, nothing } from "simple-object-sync";

@syncObject({
  beforeSendToClient({instance, constructor, typeId, destinationClientConnection}) {
    // Client should receive a different type than this:
    return OtherTrackableType; // ot the TypeId string of an other type like: "TheTypeIdOfSomethingElse"

    // The client should receive the object without any type changes
    return typeId;

    // The client should receive nothing, no object should be sent to the client
    return nothing;
  }
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
  someMethod(someArgument: string) {
    return someArgument;
  }
}
```

This is how to best execute a syncable method:

```typescript
const { clientResults, hostResult } = hostObjectSync.getMethodInvokeProxy(myHostObject).someMethod(someArgument);
const hostResultValue = hostResult;

await exchangeMessagesAsync(hostObjectSync, clientObjectSync);

// clientResults must be awaited after we have exchanged messages
// tthe reason for this: only after that, we now about any clients we may have
const clientInvokeResults = await clientResults;

// now we can get the result for a specific client
// we await these too, because the time of resolve/reject may come after the previous message exchange
// this is based upon the promiseHandlingType set in the syncMethod decorator
const clientResult = await clientInvokeResults.get(someClientConnection);
```

Alternative way to invoke a method:

```typescript
const { clientResults, hostResult } = hostObjectSync.invoke(myHostObject, "someMethod", someArgument);
```

See `tests/ts/objectSync.test.ts`, `tests/ts/syncableArray.test.ts`, `tests/ts/syncableObservableArray.test.ts`, and `tests/ts/multiClient.test.ts` for more advanced scenarios and real-world patterns.

### Mock Communication Layer Example (using worker threads)

Below is a mock implementation of a communication layer using worker threads, inspired by the `worker.test.ts` and `worker.ts` files. This demonstrates how the host and client can exchange messages using a simple transport abstraction.

#### Host Side (spawns workers and exchanges messages)

```typescript
import { Worker } from "node:worker_threads";
import { ObjectSync } from "simple-object-sync";

// Helper function which creates a client with a worker and registers the client to the provided host.
function createWorkerClient(hostSync, identity) {
  const worker = new Worker("./worker.js");
  const clientToken = hostSync.registerClient({ identity });

  const workerClient = {
    clientToken,
    terminate() {
      hostSync.removeClient(clientToken);
      worker.terminate();
    },
    requestAsync(type, data) {
      return new Promise((resolve) => {
        worker.once("message", resolve);
        worker.postMessage({ type, data });
      });
    },
  };

  return workerClient;
}

// Helper function that will sync the states between the host and the clients
async function exchangeMessagesWithClientsAsync(hostSync, clients) {
  // Map to store the sync messages send from the clients
  const messagesFromClients = new Map();

  await hostSync.exchangeMessagesAsync(async (clientToken, messages) => {
    const client = clients.find((c) => c.clientToken === clientToken);

    // Exchange sync messages from the host to the client and store the sync back reply of the client
    const result = await client.requestAsync("applySyncMessages", messages);
    messagesFromClients.set(clientToken, result.messages);

    return result.methodResponses;
  });
  // Apply the sync messages from the clients (can be ignored when the clients should never send changes to the host)
  await hostSync.applyMessagesAsync(messagesFromClients);
}

// Creating and registering clients:
const clients = [];
clients.push(createWorkerClient(hostSync, "someClient"));
clients.push(createWorkerClient(hostSync, "someOtherClient"));

// Exchanging messages/updates
await exchangeMessagesWithClientsAsync(hostSync, clients);

// Cleanup
clients.forEach((c) => c.terminate());
```

#### Client Side (worker.js)

```typescript
import { parentPort } from "worker_threads";
import { ObjectSync } from "simple-object-sync";

...

const clientSync = new ObjectSync({ identity: "client", typeGenerators: [SomeTrackableClass] });
const clientTokenFromHost = clientSync.registerClient({ identity: "host" });

parentPort.on("message", async (message) => {
  if (message.type !== "applySyncMessages") {
    // Apply the changes which the host has sent and store possibly method call responses
    const methodResponses = await clientSync.applyMessagesFromClientAsync(clientTokenFromHost, message.data);

    // Retrive the tracked changes this client may have made to send it back to the host
    const messages = clientSync.getMessages();

    // call back to the host with the reply of our changes and method call results
    parentPort.postMessage({
      methodResponses,
      messages: messages.get(clientTokenFromHost),
    });
  }
});
```

This example abstracts the transport using worker threads, but you can adapt the pattern to any communication layer (e.g., sockets, web workers, etc.). The host sends messages to each client, and the client applies them and responds with any updates or method results.

## Testing

Run all tests:

```bash
npm test
```

## License

MIT
