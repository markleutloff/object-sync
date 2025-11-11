# object-sync

Synchronize object state between host and client environments with fine-grained control over properties and methods. Supports multi-client scenarios and advanced array/object synchronization.

**Note:** This library does not handle the connection or communication layer (such as transferring messages over ports, sockets, or other transport mechanisms). You are responsible for implementing the connection layer and for sending/receiving messages between host and client using your preferred method.

**Security Note:**
To prevent malicious or invalid data from being transferred, you must verify and validate all incoming and outgoing data yourself. Use the hooks provided by decorator functions (such as `canApply`, `canTrack`, `beforeSendToClient`, and `beforeExecuteOnClient`) to implement custom validation, filtering, and access control logic for your application.

An `ObjectSync` instance will only create or instantiate types registered in its `typeGenerators` list. By default, all known types marked with `@syncObject` are allowed unless you restrict the configuration. This is not a strict security measure—if you need to limit which types can be synchronized and instantiated, you must explicitly control the contents of `typeGenerators`.

## Key API Features

- **Track changes to objects and properties:**
  Use decorators to mark properties and methods for tracking. Changes are automatically detected and can be synchronized to clients.

- **Synchronize state between host and multiple clients:**
  Register multiple clients with the host. State changes are propagated to all connected clients.

- **Decorator-based API:**

  - `@syncObject`: Marks a class as trackable and synchronizable.
  - `@syncProperty`: Marks a property for change tracking and synchronization.
  - `@syncMethod`: Marks a method for remote invocation and synchronization. Supports hooks for argument manipulation and permission checks.

- **Message-based communication:**
  The library generates messages for state changes and method calls. You must implement the transport layer to send/receive these messages between host and clients.

- **Array and observable array synchronization:**

  - `SyncableArray`: Synchronizes array values and mutations (push, splice, etc.) between host and client.
  - `SyncableObservableArray`: Extends `SyncableArray` with event support (`on`, `off`) for reacting to changes such as items being added or removed.

- **TypeScript support:**
  All APIs are fully typed for safe and predictable usage in TypeScript projects.

  **Custom Serializable Types:**
  You can create custom serializable types and register serializers/deserializers for them. These types will not be tracked by the system, but can be serialized and deserialized for transfer between host and client. This is useful for handling data structures or classes that do not require change tracking but need to be sent across the connection. See `SerializableClass` and its serializer in `objectSync.test.ts` for an example.

  Serializers/deserializers can be implemented in different ways, such as providing a `serialize` function to convert an object to plain data, and a `deserialize` function to reconstruct the object from data. Register your custom serializers in the `typeSerializers` option when creating an ObjectSync instance.

## Installation

```bash
npm install simple-object-sync
```

## Usage Examples

### 1. Trackable Objects and Methods

```typescript
import { syncObject, syncProperty, syncMethod } from "simple-object-sync";

// Mark the class as trackable and synchronizable
@syncObject()
class Root {
  // Track changes to this property and sync to clients
  @syncProperty() accessor value: number = 0;

  // Allow remote invocation of this method from clients
  @syncMethod({
    promiseHandlingType: "await", // Await the result before responding
    beforeExecuteOnClient(object, methodName, args, clientConnection) {
      // Example: modify arguments before execution on client
      args[0] = args[0] + clientConnection.identity;
      return true; // Allow execution
    },
  })
  invoke(returnValue: string) {
    return returnValue;
  }
}
```

### 2. Host and Multi-Client Setup

```typescript
import { ObjectSync } from "simple-object-sync";

// Create the host instance and register trackable types
const hostSync = new ObjectSync({
  identity: "host", // Unique identity for the host
  typeGenerators: [Root], // List of trackable types
});

// Register multiple clients with unique identities
const clients = [];
for (let i = 0; i < 3; i++) {
  const clientToken = hostSync.registerClient({ identity: "client" + i });
  clients.push(clientToken);
}
// Each client will receive synchronized state and updates
```

### 3. Array Synchronization

hostSync.track(alpha);

Synchronize changes to arrays and observable arrays between host and client.

```typescript
import { SyncableArray, SyncableObservableArray } from "simple-object-sync";

// Host: Track a SyncableArray instance
const alpha = new SyncableArray<string>(["init1", "init2"]);
hostSync.track(alpha);

// Client: Find the synchronized array instance
const alphaClient = clientSync.findObjectOfType(SyncableArray<string>)!;
assert.deepStrictEqual(alpha.value, alphaClient.value); // Values are kept in sync

// For event-driven array changes, use SyncableObservableArray
const observableAlphaClient = clientSync.findObjectOfType(SyncableObservableArray<string>)!;
// Listen for items being added
observableAlphaClient.on("added", (items, start) => {
  // handle added items
});
// Listen for items being removed
observableAlphaClient.on("removed", (items, start) => {
  // handle removed items
});
// You can also use 'off' to remove event listeners
```

### 4. Advanced Object Synchronization

- **Sync serializable types:**
  Use custom serializers to synchronize complex objects and classes.
- **Control property/method sync with decorators:**
  Use hooks like `beforeSendToClient`, `canApply`, and `beforeExecuteOnClient` for fine-grained control over what gets synchronized and when.
- **Multi-client message exchange:**
  Efficiently propagate changes and method calls to all registered clients.

See `tests/ts/objectSync.test.ts`, `tests/ts/syncableArray.test.ts`, `tests/ts/syncableObservableArray.test.ts`, and `tests/ts/multiClient.test.ts` for more advanced scenarios and real-world patterns.

### 5. Mock Communication Layer Example (using worker threads)

Below is a mock implementation of a communication layer using worker threads, inspired by the `worker.test.ts` and `worker.ts` files. This demonstrates how the host and client can exchange messages using a simple transport abstraction.

#### Host Side (spawns workers and exchanges messages)

```typescript
import { Worker } from "node:worker_threads";
import { ObjectSync } from "simple-object-sync";

function createWorker(hostSync, id) {
  const worker = new Worker("./worker.js");
  const clientToken = hostSync.registerClient({ identity: "client" + id });
  return {
    clientToken,
    terminate() {
      worker.terminate();
    },
    requestAsync(type, data) {
      return new Promise((resolve) => {
        worker.once("message", resolve);
        worker.postMessage({ type, data });
      });
    },
  };
}

async function exchangeMessagesAsync(hostSync, clients) {
  const messagesFromClients = new Map();
  await hostSync.exchangeMessagesAsync(async (clientToken, messages) => {
    const client = clients.find((c) => c.clientToken === clientToken);
    const result = await client.requestAsync("messages", messages);
    messagesFromClients.set(clientToken, result.messages);
    return result.methodResponses;
  });
  await hostSync.applyMessagesAsync(messagesFromClients);
}
```

#### Client Side (worker.js)

```typescript
import { parentPort } from "worker_threads";
import { ObjectSync } from "simple-object-sync";

const clientSync = new ObjectSync({ identity: "client", typeGenerators: [Root] });
const clientTokenFromHost = clientSync.registerClient({ identity: "host" });

parentPort.on("message", async (message) => {
  if (message.type === "messages") {
    const messagesByClient = new Map();
    messagesByClient.set(clientTokenFromHost, message.data);
    const methodResponses = (await clientSync.applyMessagesAsync(messagesByClient)).get(clientTokenFromHost);
    const messages = clientSync.getMessages();
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
