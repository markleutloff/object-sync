import { describe, it, beforeEach } from "node:test";
import { ObjectSync, ClientToken, Message } from "../../src/index.js";
import assert from "assert";
import { SyncableObservableArray } from "../../src/serialization/index.js";

describe("SyncableObservableArray Serializer", () => {
  let sourceSync: ObjectSync;
  let destSync: ObjectSync;
  let sourceObject: SyncableObservableArray<any>;
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

    sourceObject = new SyncableObservableArray();
    sourceObject.push("value1");
    sourceSync.track(sourceObject, "main");
  });

  it("should emit events on client and host", async () => {
    await sendDataToDest();

    const destObject = destSync.findOne<SyncableObservableArray<any>>(SyncableObservableArray, "main")!;

    let hasSourceEmittedAddedEvent = false;
    sourceObject.once("added", (items) => {
      if (items.length === 2 && items[0] === "value3" && items[1] === "value4") {
        hasSourceEmittedAddedEvent = true;
      }
    });
    sourceObject.push("value3", "value4");
    assert(hasSourceEmittedAddedEvent);
    let hasDestEmittedAddedEvent = false;
    destObject.once("added", (items) => {
      if (items.length === 2 && items[0] === "value3" && items[1] === "value4") {
        hasDestEmittedAddedEvent = true;
      }
    });
    await sendDataToDest();
    assert(hasDestEmittedAddedEvent);

    let hasSourceEmittedRemovedEvent = false;
    sourceObject.once("removed", (items) => {
      if (items.length === 1 && items[0] === "value1") {
        hasSourceEmittedRemovedEvent = true;
      }
    });
    sourceObject.splice(0, 1);
    assert(hasSourceEmittedRemovedEvent);
    let hasDestEmittedRemovedEvent = false;
    destObject.once("removed", (items) => {
      if (items.length === 1 && items[0] === "value1") {
        hasDestEmittedRemovedEvent = true;
      }
    });
    await sendDataToDest();
    assert(hasDestEmittedRemovedEvent);
  });
});
