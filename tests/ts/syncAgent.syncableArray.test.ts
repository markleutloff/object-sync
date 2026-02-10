import { describe, it, beforeEach } from "node:test";
import { SyncableArray, ObjectSync, syncMethod, syncProperty, syncObject, ChangeObjectMessage, ClientToken, Message } from "../../src/index.js";
import { SpliceInstruction } from "../../src/syncAgents/agents/array/changeSet.js";
import assert from "assert";

@syncObject()
class Alpha {
  @syncProperty()
  accessor someReference: Beta | null = null;

  @syncMethod({
    promiseHandlingType: "await",
  })
  doSomething(a: number, b: number) {
    // Do nothing
    return a + b;
  }
}

@syncObject()
class Beta {}

describe("SyncableArray Serializer", () => {
  let sourceSync: ObjectSync;
  let destSync: ObjectSync;
  let sourceArray: any[];
  let sourceSyncDestClientToken: ClientToken;
  let destSyncDestClientToken: ClientToken;

  const sendDataToDest = async (messages?: Message[]) => {
    messages ??= sourceSync.getMessages(sourceSyncDestClientToken);
    messages = JSON.parse(JSON.stringify(messages)) as Message[]; // Deep clone to simulate real message transfer
    await destSync.applyMessagesAsync(messages, destSyncDestClientToken);
    return messages;
  };

  const assertArraysEqual = (arr1: any[], arr2: any[]) => {
    assert(arr1.length === arr2.length);
    for (let i = 0; i < arr1.length; i++) {
      assert(arr1[i] === arr2[i]);
    }
  };

  beforeEach(() => {
    sourceSync = new ObjectSync({
      identity: "source",
      types: [Alpha, Beta, SyncableArray],
    });
    sourceSyncDestClientToken = sourceSync.registerClient({ identity: "dest" });
    destSync = new ObjectSync({
      identity: "dest",
      types: [Alpha, Beta, SyncableArray],
    });
    destSyncDestClientToken = destSync.registerClient({ identity: "source" });

    sourceArray = new SyncableArray(1, 2, 3, 4, 5);
    sourceSync.track(sourceArray);
  });

  it("should transfer initial data", async () => {
    await sendDataToDest();

    const destArray = destSync.rootObjects.findOne<SyncableArray<any>>(SyncableArray)!;

    assert(Boolean(destArray));
    assertArraysEqual(sourceArray, destArray);
  });

  it("should clear the array", async () => {
    await sendDataToDest();
    const destArray = destSync.rootObjects.findOne<any[]>(Array)!;

    sourceArray.length = 0;
    await sendDataToDest();

    assertArraysEqual(sourceArray, destArray);
  });

  it("should transfer push", async () => {
    await sendDataToDest();

    sourceArray.push(6);
    await sendDataToDest();

    const destArray = destSync.rootObjects.findOne<any[]>(Array)!;

    assertArraysEqual(sourceArray, destArray);
  });

  it("should transfer simple remove", async () => {
    await sendDataToDest();
    sourceArray.splice(1, 1);
    await sendDataToDest();
    const destArray = destSync.rootObjects.findOne<any[]>(Array)!;

    assertArraysEqual(sourceArray, destArray);
  });

  it("should transfer splice", async () => {
    await sendDataToDest();

    sourceArray.splice(2, 2, 10, 11, 12);
    await sendDataToDest();

    const destArray = destSync.rootObjects.findOne<any[]>(Array)!;
    assertArraysEqual(sourceArray, destArray);
  });

  it("should merge multiple push", async () => {
    await sendDataToDest();

    sourceArray.push(6);
    sourceArray.push(7);

    let messages = sourceSync.getMessages(sourceSyncDestClientToken);
    const changeMessage = messages.find((msg) => msg.type === "change") as ChangeObjectMessage<SpliceInstruction[]>;
    assert(changeMessage.data.length === 1);

    await sendDataToDest(messages);

    const destArray = destSync.rootObjects.findOne<any[]>(Array)!;
    assertArraysEqual(sourceArray, destArray);
  });

  it("should merge multiple splices", async () => {
    await sendDataToDest();

    sourceArray.splice(1, 1);
    sourceArray.splice(1, 1);

    let messages = sourceSync.getMessages(sourceSyncDestClientToken);
    const changeMessage = messages.find((msg) => msg.type === "change") as ChangeObjectMessage<SpliceInstruction[]>;
    assert(changeMessage.data.length === 1);

    await sendDataToDest(messages);

    const destArray = destSync.rootObjects.findOne<any[]>(Array)!;
    assertArraysEqual(sourceArray, destArray);
  });

  it("should transfer set length", async () => {
    await sendDataToDest();

    sourceArray.length = 3;
    await sendDataToDest();

    const destArray = destSync.rootObjects.findOne<any[]>(Array)!;
    assertArraysEqual(sourceArray, destArray);
  });

  it("should clean up stored references", async () => {
    await sendDataToDest();

    sourceSync.untrack(sourceArray);

    await sendDataToDest();

    assert(destSync.allObjects.all.length === 0);
  });

  it("should be able to merge splices when compareStates (the default) is set", async () => {
    await sendDataToDest();

    const arrayDispatcher = sourceSync.getSyncAgent(sourceArray)!;
    arrayDispatcher.changeSetMode = "compareStates";

    sourceArray.push(6);
    sourceArray.push(7);
    sourceArray.push(8);
    sourceArray.push(9);
    sourceArray.unshift(0);

    const messages = await sendDataToDest();
    const changeMessages = messages.find((msg) => msg.type === "change") as ChangeObjectMessage<SpliceInstruction[]>;
    assert(changeMessages.data.length === 2);

    const destArray = destSync.rootObjects.findOne<any[]>(Array)!;
    assertArraysEqual(sourceArray, destArray);
  });

  it("should be able to all splices when trackSplices is set", async () => {
    await sendDataToDest();

    const arrayDispatcher = sourceSync.getSyncAgent(sourceArray)!;
    arrayDispatcher.changeSetMode = "trackSplices";

    sourceArray.push(6);
    sourceArray.push(7);
    sourceArray.push(8);
    sourceArray.push(9);
    sourceArray.unshift(0);

    const messages = await sendDataToDest();
    const changeMessages = messages.find((msg) => msg.type === "change") as ChangeObjectMessage<SpliceInstruction[]>;
    assert(changeMessages.data.length === 5);

    const destArray = destSync.rootObjects.findOne<any[]>(Array)!;
    assertArraysEqual(sourceArray, destArray);
  });
});
