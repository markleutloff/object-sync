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
npm install object-sync
```

## Basic Usage

### 1. Define Trackable Objects

```typescript
import { syncObject, syncProperty, syncMethod } from "object-sync";

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
import { ObjectSync } from "object-sync";

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
const clientBeta = clientSync.client.findTrackedObject(Beta)!;
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
import { getHostObjectInfo } from "object-sync";

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

## API Overview

- `ObjectSync`: Main class for host/client sync
- `syncObject`, `syncProperty`, `syncMethod`: Decorators for marking objects/properties/methods
- `ObjectSyncHost`, `ObjectSyncClient`: Direct host/client APIs
- Message exchange: `getMessages()`, `applyMessages()`

## License

MIT
