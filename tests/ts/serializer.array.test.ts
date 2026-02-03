import { describe, it, beforeEach } from "node:test";
import { ObjectSync, ClientToken, Message } from "../../src/index.js";
import { assertObjectsEqual } from "./utils.js";
import assert from "assert";

describe("Array Serializer", () => {
  let sourceSync: ObjectSync;
  let destSync: ObjectSync;
  let sourceArray: any[];
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

    sourceArray = [1, "string", [42, false, true]];
    sourceSync.track(sourceArray, "main");
  });

  it("should transfer initial data", async () => {
    await sendDataToDest();

    const destArray = destSync.findOne<any[]>(Array, "main")!;

    assert(Boolean(destArray));
    assertObjectsEqual(sourceArray, destArray);
  });

  it("should clean up stored references", async () => {
    await sendDataToDest();

    sourceSync.untrack(sourceArray);

    await sendDataToDest();

    assert(destSync.allTrackedObjects.length === 0);
  });

  it("should not send any changes when not reported", async () => {
    await sendDataToDest();

    const destArray = destSync.findOne<any[]>(Array, "main")!;

    sourceArray.push("new item");

    // should not send any changes
    await sendDataToDest();
    assert(destArray.length !== sourceArray.length);
  });

  it("should be able to transfer changes when reported through the dispatcher", async () => {
    await sendDataToDest();

    const destArray = destSync.findOne<any[]>(Array, "main")!;
    sourceArray.push("new item");

    const arrayDispatcher = sourceSync.getDispatcher(sourceArray)!;
    arrayDispatcher.reportSplice();

    await sendDataToDest();
    assertObjectsEqual(sourceArray, destArray);
  });

  it("should be able to transfer manually reported changes", async () => {
    await sendDataToDest();

    const destArray = destSync.findOne<any[]>(Array, "main")!;

    const arrayDispatcher = sourceSync.getDispatcher(sourceArray)!;
    arrayDispatcher.changeSetMode = "trackSplices";
    arrayDispatcher.reportSplice(0, sourceArray.length);

    await sendDataToDest();

    // splice the source here as we want to check that only a manual splice report causes the change
    sourceArray.splice(0, sourceArray.length);

    assertObjectsEqual(sourceArray, destArray);
  });
});
