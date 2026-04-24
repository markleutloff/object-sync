import { syncObject, syncProperty, ClientToken, ObjectSync, createSimpleSyncAgentProvider, ObjectSyncSettings, SyncAgentProvider } from "../../src/index.js";
import { ExtendedSyncAgent } from "../../src/syncAgents/extendedSyncAgent.js";
import { describe, it, beforeEach } from "node:test";
import assert from "assert";

class ImmutablePoint {
  readonly x: number;
  readonly y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

@syncObject()
class Root {
  @syncProperty()
  accessor point: ImmutablePoint | null = null;

  @syncProperty()
  accessor value: number = 0;
}

describe("Inline value serialization (serializeAsValue)", () => {
  let hostSync: ObjectSync;
  let clientSync: ObjectSync;
  let hostClientToken: ClientToken;
  let clientHostToken: ClientToken;
  let hostRoot: Root;

  beforeEach(() => {
    createSimpleSyncAgentProvider<ImmutablePoint, { x: number; y: number }>({
      typeId: "ImmutablePoint",
      type: ImmutablePoint,
      serialize: (obj) => ({ x: obj.x, y: obj.y }),
      deserialize: (data) => new ImmutablePoint(data.x, data.y),
    });

    hostSync = new ObjectSync({ identity: "host" });
    clientSync = new ObjectSync({
      identity: "client",
      types: [ImmutablePoint, Root],
    });

    hostClientToken = hostSync.registerClient({ identity: "client" });
    clientHostToken = clientSync.registerClient({ identity: "host" });

    hostRoot = new Root();
    hostSync.track(hostRoot);
  });

  const exchangeMessagesAsync = async () => {
    const messagesFromHost = hostSync.getMessages(hostClientToken);
    await clientSync.applyMessagesAsync(messagesFromHost, clientHostToken);
    const messagesFromClient = clientSync.getMessages(clientHostToken);
    await hostSync.applyMessagesAsync(messagesFromClient, hostClientToken);
  };

  it("value type should not be tracked in object pool", async () => {
    hostRoot.point = new ImmutablePoint(1, 2);
    hostSync.getMessages(hostClientToken);

    assert.strictEqual(hostSync.allObjects.all.length, 1, "Only Root should be tracked, not ImmutablePoint");
  });

  it("value type should serialize and deserialize correctly", async () => {
    hostRoot.point = new ImmutablePoint(3, 4);
    await exchangeMessagesAsync();

    const clientRoot = clientSync.rootObjects.findOne(Root)!;
    assert(clientRoot, "Client should have Root");
    assert(clientRoot.point, "Client Root should have point");
    assert.notStrictEqual(clientRoot.point, hostRoot.point, "Should be different instances");
    assert(clientRoot.point instanceof ImmutablePoint, "Should be an ImmutablePoint");
    assert.strictEqual(clientRoot.point.x, 3);
    assert.strictEqual(clientRoot.point.y, 4);
  });

  it("value type changes should propagate", async () => {
    hostRoot.point = new ImmutablePoint(1, 2);
    await exchangeMessagesAsync();

    hostRoot.point = new ImmutablePoint(5, 6);
    await exchangeMessagesAsync();

    const clientRoot = clientSync.rootObjects.findOne(Root)!;
    assert.strictEqual(clientRoot.point!.x, 5);
    assert.strictEqual(clientRoot.point!.y, 6);
  });

  it("value type should not generate delete messages", async () => {
    hostRoot.point = new ImmutablePoint(1, 2);
    await exchangeMessagesAsync();

    hostRoot.point = null;
    const messages = hostSync.getMessages(hostClientToken);

    const deleteMessages = messages.filter((m) => m.type === "delete");
    assert.strictEqual(deleteMessages.length, 0, "Should have no delete messages for inline value types");

    const changeMessages = messages.filter((m) => m.type === "change");
    assert.strictEqual(changeMessages.length, 1, "Should have one change message for Root");
  });

  it("pool size stays constant across many changes", async () => {
    for (let i = 0; i < 100; i++) {
      hostRoot.point = new ImmutablePoint(i, i * 2);
      hostSync.getMessages(hostClientToken);
    }

    assert.strictEqual(hostSync.allObjects.all.length, 1, "Only Root should be in pool after 100 changes");
  });

  it("provider without serialize/deserialize still tracks normally", async () => {
    class TrackedPoint {
      x: number;
      y: number;
      constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
      }
    }

    // Register WITHOUT passing serialize/deserialize through to the provider
    const SyncAgent = class extends ExtendedSyncAgent<TrackedPoint> {
      override getTypeId(): string {
        return "TrackedPoint";
      }
      override generateMessages(clientToken: ClientToken, isNewClient: boolean) {
        if (isNewClient) return [this.createMessage("create", { x: this.instance.x, y: this.instance.y }, clientToken)];
        return [];
      }
      onCreateMessageReceived(message: any): void {
        this.instance = new TrackedPoint(message.data.x, message.data.y);
      }
    };

    const provider = new SyncAgentProvider({
      syncAgentType: SyncAgent,
      syncType: TrackedPoint,
      typeId: "TrackedPoint",
      matchExactType: true,
      // No serialize/deserialize — should still track as reference
    });

    @syncObject()
    class Root2 {
      @syncProperty()
      accessor tracked: TrackedPoint | null = null;
    }

    const hostSync2 = new ObjectSync({ identity: "host", types: [provider, Root2] });
    const clientToken2 = hostSync2.registerClient({ identity: "client" });

    const root2 = new Root2();
    hostSync2.track(root2);
    root2.tracked = new TrackedPoint(10, 20);
    hostSync2.getMessages(clientToken2);

    assert.strictEqual(hostSync2.allObjects.all.length, 2, "Both Root2 and TrackedPoint should be tracked");
  });
});
