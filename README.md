# object-sync

Tracks changes on objects and notifies clients. Synchronize object state between host and client environments with fine-grained control over properties and methods.

**Note:** This library does not handle the communication layer (such as transferring messages over ports, sockets, or other transport mechanisms). You are responsible for sending and receiving messages between host and client using your preferred method.

## Features

- Track changes to objects and properties
- Synchronize state between host and client
- Decorator-based API for marking trackable objects and properties
- Message-based communication for updates
- TypeScript support

## Installation

```bash
npm install simple-object-sync
npm i --save-dev @types/simple-object-sync
```

## Basic Usage

### 1. Define Trackable Objects

```typescript
import { syncObject, syncProperty, syncMethod } from "simple-object-sync";

@syncObject({ typeId: "Beta" })
class Beta {
  constructor(value: number = 0) {
    this.value = value;
  }
  @syncProperty() accessor value: number;

  // Example of a method synchronized across clients
  @syncMethod()
  increment() {
    this.value++;
  }
}
```

### 2. Create Host and Client

```typescript
import { ObjectSync } from "simple-object-sync";

const hostSync = new ObjectSync({});
const clientSync = new ObjectSync({});

const beta = new Beta(0);
const hostClientToken = hostSync.host.registerClient();
const clientClientToken = clientSync.host.registerClient();
hostSync.host.track(beta);
```

### 3. Synchronize State

```typescript
function exchangeMessages() {
  const h2cMessages = hostSync.getMessages();
  clientSync.applyMessages(h2cMessages);
  const c2hMessages = clientSync.getMessages();
  hostSync.applyMessages(c2hMessages);
}

beta.value = 1;
exchangeMessages();
const clientBeta = clientSync.client.findObjectOfType(Beta)!;
console.log(clientBeta.value); // 1

beta.value = 2;
exchangeMessages();
console.log(clientBeta.value); // 2
```

### 4. Synchronize Methods

When you decorate a method with `@syncMethod()`, calling this method on the host will schedule its execution on all clients. The method will be executed after all other property changes have been applied on any client, ensuring state consistency before method logic runs.

```typescript
beta.increment(); // Host increments value
exchangeMessages();
console.log(clientBeta.value); // 3 (method executed after sync)
```

## Restricting Changes to Specific Clients

You can control which clients receive updates for tracked objects and properties using client-specific views and filters.

### Example: Only Allow Certain Clients to Receive Changes

```typescript
import { getHostObjectInfo } from "simple-object-sync";

// Register clients with optional designation
const clientA = hostSync.host.registerClient({ designation: "A" });
const clientB = hostSync.host.registerClient({ designation: "B" });

// Track an object and restrict visibility to clientA only
hostSync.host.track(beta, {
  clientVisibility: { clients: clientA, isExclusive: true },
});

// Add a client-specific view to further customize property values for a client
getHostObjectInfo(beta)?.addView({
  filter: { clients: new Set([clientA]), isExclusive: true },
  onProperty(client, key, propertyInfo) {
    if (key === "value") return { value: 999 };
    return propertyInfo;
  },
});
```

## Designation Usage

When creating `ObjectSync` instances or registering clients, you can specify a `designation` value:

- `designation` is a string that identifies the role or type of a client or host (e.g., "host", "clientA", "clientB").
- This value is used in message transfer and application to filter which clients should receive or apply certain changes.
- You can use designations in `ClientFilter` to include or exclude clients by their designation.
- syncObject, syncProperty and synncMethod decorators can receive the designations property too, which also acts as an filter.

### Example: Using Designation

```typescript
const hostSync = new ObjectSync({ designation: "host" });
const clientSyncA = new ObjectSync({ designation: "clientA" });
const clientSyncB = new ObjectSync({ designation: "clientB" });

const clientA = hostSync.host.registerClient({ designation: "clientA" });
const clientB = hostSync.host.registerClient({ designation: "clientB" });

// Use designation in clientVisibility filter
hostSync.host.track(beta, {
  clientVisibility: { designations: "clientA", isExclusive: true },
});
```

### SyncableArray Example

```typescript
import { SyncableArray, ObjectSync } from "simple-object-sync";

// Create host and client sync instances
const hostSync = new ObjectSync({});
const clientSync = new ObjectSync({});

// Create a SyncableArray and track it on the host
const arr = new SyncableArray<number>([1, 2, 3]);
const clientToken = hostSync.host.registerClient();
hostSync.host.track(arr, { clientVisibility: { clients: clientToken } });

// Exchange messages to sync initial state
const creationMessages = hostSync.getMessages().get(clientToken)!;
clientSync.client.apply(creationMessages);

// Access the synced array on the client
const clientArr = clientSync.client.findObjectOfType(SyncableArray)!;
console.log(clientArr.value); // [1, 2, 3]

// Make changes on the host
arr.push(4, 5);
arr.splice(1, 1); // Remove the second item

// Sync changes to the client
const changeMessages = hostSync.getMessages().get(clientToken)!;
clientSync.client.apply(changeMessages);

console.log(clientArr.value); // [1, 3, 4, 5]
```

The SyncableArray provides two methods which can be overridden to add EventEmitter features by subclassing it:

```typescript
protected onRemoved(start: number, items: T[]): void {
}

protected onAdded(start: number, items: T[]): void {
}
```

## API Overview

### Main Classes

- `ObjectSync`: Unified host/client sync manager
- `ObjectSyncHost`: Host-side API for tracking and synchronizing objects
- `ObjectSyncClient`: Client-side API for applying changes and tracking objects
- `SyncableArray`: Array-like object with syncable state and change tracking
- `TrackedObjectPool`: Internal pool for managing tracked objects

### Decorators

- `@syncObject`: Marks a class as trackable and synchronizable
- `@syncProperty`: Marks a property for synchronization
- `@syncMethod`: Marks a method for remote execution

### Types & Utilities

- `ClientConnection`, `ClientConnectionSettings`: Represent client identity and configuration
- `ClientFilter`, `ClientSpecificView`: Control visibility and customize sync for clients
- `Message`, `CreateObjectMessage`, `ChangeObjectMessage`, `DeleteObjectMessage`, `ExecuteObjectMessage`: Message types for sync protocol
- `PropertyInfo`, `PropertyInfos`: Property value and metadata for sync
- `TrackSettings`, `ObjectSyncSettings`, `ObjectSyncHostSettings`, `ObjectSyncClientSettings`: Configuration types
- `TrackableTargetGenerator`: Custom generator for advanced object creation

### Key Methods

- `getMessages()`: Retrieve all sync messages for clients
- `applyMessages(messages)`: Apply received messages to update state
- `track(object, settings?)`: Begin tracking an object on the host
- `registerClient(settings?)`: Register a new client for sync
- `findObjectOfType(Type, objectId?)`: Find a tracked object by type
- `addView(object, view)`: Add a client-specific view for property customization

### Advanced Concepts

- **Designation**: Filter which clients receive or apply changes using roles
- **Client-specific views**: Customize property values or visibility per client
- **SyncableArray events**: Override `onAdded` and `onRemoved` for event-driven array changes

See the source code and type definitions for more advanced usage and extension points.

## License

MIT
