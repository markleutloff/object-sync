import { describe, it, beforeEach } from "node:test";
import { ObjectSync, ClientToken, Message } from "../../src/index.js";
import { assertObjectsEqual } from "./utils.js";
import assert from "assert";
import { SyncableSet } from "../../src/syncAgents/index.js";

describe("SyncableSet Serializer", () => {
  let sourceSync: ObjectSync;
  let destSync: ObjectSync;
  let sourceObject: Set<any>;
  let sourceSyncDestClientToken: ClientToken;
  let destSyncDestClientToken: ClientToken;

  const sendDataToDest = async (messages?: Message[]) => {
    messages ??= sourceSync.getMessages(sourceSyncDestClientToken);
    await destSync.applyMessagesAsync(messages, destSyncDestClientToken);
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

    sourceObject = new SyncableSet();
    sourceObject.add("value1");
    sourceObject.add(42);
    sourceObject.add(true);
    sourceObject.add(new Set(["innerValue"]));
    sourceSync.track(sourceObject, "main");
  });

  it("should transfer initial data", async () => {
    await sendDataToDest();

    const destObject = destSync.rootObjects.findOne<Set<any>>(Set, "main")!;

    assert(Boolean(destObject));
    assertObjectsEqual(sourceObject, destObject);
  });

  it("should clean up stored references", async () => {
    await sendDataToDest();

    sourceSync.untrack(sourceObject);

    await sendDataToDest();

    assert(destSync.allObjects.all.length === 0);
  });
});
