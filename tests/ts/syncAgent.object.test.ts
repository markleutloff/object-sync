import { describe, it, beforeEach } from "node:test";
import { ObjectSync, ClientToken, Message } from "../../src/index.js";
import { assertObjectsEqual } from "./utils.js";
import assert from "assert";

type ObjectType = {
  a: number;
  b: string;
  other: {
    value: number;
  };
};

describe("Object Serializer", () => {
  let sourceSync: ObjectSync;
  let destSync: ObjectSync;
  let sourceObject: ObjectType;
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

    sourceObject = {
      a: 1,
      b: "string",
      other: {
        value: 42,
      },
    };
    sourceSync.track(sourceObject, "main");
  });

  it("should transfer initial data", async () => {
    await sendDataToDest();

    const destObject = destSync.rootObjects.findOne<Object>(Object, "main")! as ObjectType;

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
