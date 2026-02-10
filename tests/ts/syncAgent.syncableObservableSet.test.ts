import { describe, it, beforeEach } from "node:test";
import { ObjectSync, ClientToken, Message } from "../../src/index.js";
import assert from "assert";
import { SyncableObservableSet } from "../../src/syncAgents/index.js";

describe("SyncableObservableSet Serializer", () => {
  let sourceSync: ObjectSync;
  let destSync: ObjectSync;
  let sourceObject: SyncableObservableSet<any>;
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
    sourceSyncDestClientToken = sourceSync.registerClient({ identity: "dest" });
    destSync = new ObjectSync({
      identity: "dest",
    });
    destSyncDestClientToken = destSync.registerClient({ identity: "source" });

    sourceObject = new SyncableObservableSet();
    sourceObject.add("key1");
    sourceObject.add("key2");
    sourceSync.track(sourceObject, "main");
  });

  it("should emit events on client and host", async () => {
    await sendDataToDest();

    const destObject = destSync.rootObjects.findOne<SyncableObservableSet<any>>(SyncableObservableSet, "main")!;

    let hasSourceEmittedSetEvent = false;
    sourceObject.once("added", (value) => {
      if (value === "key3") {
        hasSourceEmittedSetEvent = true;
      }
    });
    sourceObject.add("key3");
    assert(hasSourceEmittedSetEvent);
    let hasDestEmittedSetEvent = false;
    destObject.once("added", (value) => {
      if (value === "key3") {
        hasDestEmittedSetEvent = true;
      }
    });
    await sendDataToDest();
    assert(hasDestEmittedSetEvent);

    let hasSourceEmittedDeleteEvent = false;
    sourceObject.once("deleted", (value) => {
      if (value === "key1") {
        hasSourceEmittedDeleteEvent = true;
      }
    });
    sourceObject.delete("key1");
    assert(hasSourceEmittedDeleteEvent);
    let hasDestEmittedDeleteEvent = false;
    destObject.once("deleted", (value) => {
      if (value === "key1") {
        hasDestEmittedDeleteEvent = true;
      }
    });
    await sendDataToDest();
    assert(hasDestEmittedDeleteEvent);

    let hasSourceEmittedClearedEvent = false;
    sourceObject.once("cleared", () => {
      hasSourceEmittedClearedEvent = true;
    });
    sourceObject.clear();
    assert(hasSourceEmittedClearedEvent);
    let hasDestEmittedClearedEvent = false;
    destObject.once("cleared", () => {
      hasDestEmittedClearedEvent = true;
    });
    await sendDataToDest();
    assert(hasDestEmittedClearedEvent);
  });
});
