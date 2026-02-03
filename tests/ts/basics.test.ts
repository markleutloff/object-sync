import { ObjectSync, ClientToken, syncObject, syncProperty, Message } from "../../src/index.js";
import { describe, it, beforeEach } from "node:test";
import assert from "assert";

@syncObject({ typeId: "Alpha" })
class Alpha {
  @syncProperty()
  public accessor beta: Beta | null = null;
}

@syncObject({ typeId: "Beta" })
class Beta {
  @syncProperty()
  public accessor value: string = "default";
}

describe("Basics", () => {
  let sourceSync: ObjectSync;
  let destSync: ObjectSync;
  let sourceSyncDestClientToken: ClientToken;
  let destSyncDestClientToken: ClientToken;

  const sendDataToDest = async (messages?: Message[]) => {
    messages ??= sourceSync.getMessages(sourceSyncDestClientToken);
    await destSync.applyMessagesAsync(messages, destSyncDestClientToken);
  };

  const sendDataToSource = async (messages?: Message[]) => {
    messages ??= destSync.getMessages(destSyncDestClientToken);
    await sourceSync.applyMessagesAsync(messages, sourceSyncDestClientToken);
  };

  beforeEach(() => {
    sourceSync = new ObjectSync({
      identity: "source",
    });
    sourceSyncDestClientToken = sourceSync.registerClient({ identity: "dest" });
    destSync = new ObjectSync({
      identity: "dest",
    });
    destSyncDestClientToken = destSync.registerClient({ identity: "source" });
  });

  it("should report new items", async () => {
    const instance = new Alpha();
    instance.beta = new Beta();
    sourceSync.track(instance);

    let messages = sourceSync.getMessages().get(sourceSyncDestClientToken)!;

    // We expect 2 create messages: one for Alpha, one for Beta
    assert.strictEqual(messages.length, 2, "Expected exactly 2 messages to be generated");
    assert.strictEqual(messages.filter((m) => m.type === "create").length, 2, "Expected exactly 2 create messages to be generated");

    messages = sourceSync.getMessages().get(sourceSyncDestClientToken)!;
    assert.strictEqual(messages.length, 0, "Expected no new messages to be generated");
  });

  it("should not report items back to source", async () => {
    const instance = new Alpha();
    sourceSync.track(instance, "main");
    await sendDataToDest();

    let messages = destSync.getMessages(destSyncDestClientToken);
    assert(messages.length === 0, "Expected no messages to be sent back to source");
  });

  it("should report deleted items", async () => {
    const instance = new Alpha();
    instance.beta = new Beta();
    sourceSync.track(instance);

    let messages = sourceSync.getMessages().get(sourceSyncDestClientToken)!;
    instance.beta = null;

    messages = sourceSync.getMessages().get(sourceSyncDestClientToken)!;
    assert.strictEqual(messages.length, 2, "Expected exactly 2 messages to be generated after deletion");
    assert.strictEqual(messages.filter((m) => m.type === "change").length, 1, "Expected exactly 1 change message to be generated after deletion");
    assert.strictEqual(messages.filter((m) => m.type === "delete").length, 1, "Expected exactly 1 delete message to be generated after deletion");

    messages = sourceSync.getMessages().get(sourceSyncDestClientToken)!;
    assert.strictEqual(messages.length, 0, "Expected no new messages to be generated");

    assert.strictEqual(sourceSync.allTrackedObjects.length, 1, "Expected exactly 1 tracked object after deletion");
  });

  it("should report untracked", async () => {
    const instance = new Alpha();
    instance.beta = new Beta();
    sourceSync.track(instance);

    let messages = sourceSync.getMessages().get(sourceSyncDestClientToken)!;
    sourceSync.untrack(instance);
    messages = sourceSync.getMessages().get(sourceSyncDestClientToken)!;

    assert.strictEqual(messages.length, 2, "Expected exactly 2 messages to be generated after deletion");
    assert.strictEqual(messages.filter((m) => m.type === "delete").length, 2, "Expected exactly 2 delete messages to be generated after deletion");
    assert.strictEqual(sourceSync.allTrackedObjects.length, 0, "Expected no tracked objects after untracking");
  });
});
