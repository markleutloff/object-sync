import { describe, it, beforeEach } from "node:test";
import { ObjectSync, ClientToken, Message } from "../../src/index.js";
import { assertObjectsEqual } from "./utils.js";
import assert from "assert";
import { IMapSyncAgent } from "../../src/syncAgents/index.js";

describe("Map Serializer", () => {
  let sourceSync: ObjectSync;
  let destSync: ObjectSync;
  let sourceObject: Map<any, any>;
  let sourceSyncDestClientToken: ClientToken;
  let destSyncDestClientToken: ClientToken;

  const sendDataToDest = async (messages?: Message[]) => {
    messages ??= sourceSync.getMessages(sourceSyncDestClientToken);
    await destSync.applyMessagesAsync(messages, destSyncDestClientToken);
    return messages;
  };

  beforeEach(() => {
    sourceSync = new ObjectSync({
      identity: "source",
    });
    destSync = new ObjectSync({
      identity: "dest",
    });
    sourceSyncDestClientToken = sourceSync.registerClient({ identity: destSync.identity });
    destSyncDestClientToken = destSync.registerClient({ identity: sourceSync.identity });

    sourceObject = new Map();
    sourceObject.set("key1", "value1");
    sourceObject.set("key2", 42);
    sourceObject.set(10, true);
    sourceObject.set(10, new Map([["innerKey", "innerValue"]]));

    sourceSync.track(sourceObject, "main");
  });

  it("should transfer initial data", async () => {
    await sendDataToDest();

    const destObject = destSync.rootObjects.findOne<Map<any, any>>(Map, "main")!;

    assert(Boolean(destObject));
    assertObjectsEqual(sourceObject, destObject);
  });

  it("should clean up stored references", async () => {
    await sendDataToDest();

    sourceSync.untrack(sourceObject);

    await sendDataToDest();

    assert(destSync.allObjects.all.length === 0);
  });

  it("should send reported changes", async () => {
    await sendDataToDest();

    const destObject = destSync.rootObjects.findOne<Map<any, any>>(Map, "main")!;
    assert(destObject.size !== 0);

    const mapDispatcher = sourceSync.getSyncAgent<IMapSyncAgent>(sourceObject)!;
    mapDispatcher.reportChange("key3", "newValue");
    mapDispatcher.reportChange("key1", "newValue");
    await sendDataToDest();

    assert(destObject.get("key1") === "newValue");
    assert(destObject.get("key3") === "newValue");

    mapDispatcher.reportDelete("key1");
    const m = await sendDataToDest();

    assert(!destObject.has("key1"));

    mapDispatcher.reportClear();
    await sendDataToDest();

    assert(destObject.size === 0);
  });
});
