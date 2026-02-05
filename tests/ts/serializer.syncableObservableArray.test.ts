import { ObjectSync, SyncableObservableArray, ClientToken, syncObject, Message, ObjectSyncSettings, SyncableObservableArraySerializer } from "../../src/index.js";
import { describe, it, beforeEach } from "node:test";
import assert from "assert";

@syncObject({ typeId: "Beta" })
class Beta {}

describe("SyncableObservableArray Serializer", () => {
  let sourceSync: ObjectSync;
  let destSync: ObjectSync;
  let sourceSyncDestClientToken: ClientToken;
  let destSyncDestClientToken: ClientToken;

  let alpha: SyncableObservableArray<string>;
  let alphaClient: SyncableObservableArray<string>;

  beforeEach(async () => {
    const hostSettings: ObjectSyncSettings = {
      identity: "host",
      serializers: [Beta, SyncableObservableArraySerializer],
    };

    const clientSettings: ObjectSyncSettings = {
      identity: "client",
      serializers: [Beta, SyncableObservableArraySerializer],
    };

    sourceSync = new ObjectSync(hostSettings);
    destSync = new ObjectSync(clientSettings);

    sourceSyncDestClientToken = sourceSync.registerClient({ identity: "client" });
    destSyncDestClientToken = destSync.registerClient({ identity: "host" });

    alpha = new SyncableObservableArray<string>("init1", "init2");
    sourceSync.track(alpha);

    await sendDataToDest();
    alphaClient = destSync.findOne<SyncableObservableArray<string>>(SyncableObservableArray)!;
  });

  const sendDataToDest = async (messages?: Message[]) => {
    messages ??= sourceSync.getMessages(sourceSyncDestClientToken);
    await destSync.applyMessagesAsync(messages, destSyncDestClientToken);
  };

  it("should report new items", async () => {
    let hasTwoNewItems = false;

    alphaClient.on("added", (items, start) => {
      hasTwoNewItems = items.length === 2;
    });

    alpha.push("value3", "value4");

    await sendDataToDest();

    assert.ok(hasTwoNewItems);
  });

  it("should report removed items", async () => {
    let hasTwoRemovedItems = false;

    alphaClient.on("removed", (items, start) => {
      hasTwoRemovedItems = items.length === 2;
    });

    alpha.splice(0, 2);

    await sendDataToDest();

    assert.ok(hasTwoRemovedItems);
  });

  it("should report added and removed items", async () => {
    let hasRemovedItem = false;
    let hasTwoNewItems = false;

    alphaClient.on("removed", (items, start) => {
      hasRemovedItem = items.length === 1 && start === 1;
    });

    alphaClient.on("added", (items, start) => {
      hasTwoNewItems = items.length === 2;
    });

    alpha.splice(1, 1);
    alpha.push("value3", "value4");

    await sendDataToDest();

    assert.ok(hasRemovedItem);
    assert.ok(hasTwoNewItems);
  });

  it("should clean up stored references", async () => {
    sourceSync.untrack(alpha);

    await sendDataToDest();

    assert(destSync.allTrackedObjects.length === 0);
  });
});
