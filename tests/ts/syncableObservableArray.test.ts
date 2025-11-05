import { SyncableObservableArray, ClientConnection, syncObject } from "../../src/index.js";
import { describe, it, beforeEach } from "node:test";
import assert from "assert";
import { ObjectSyncHost, ObjectSyncClient } from "../../src/index.js";

@syncObject({ typeId: "Beta" })
class Beta {}

describe("ObjectSync client-host integration (SyncableArray)", () => {
  let host: ObjectSyncHost;
  let client: ObjectSyncClient;
  let alpha: SyncableObservableArray<string>;
  let alphaClient: SyncableObservableArray<string>;
  let clientToken: ClientConnection;

  beforeEach(async () => {
    host = new ObjectSyncHost();
    client = new ObjectSyncClient();
    alpha = new SyncableObservableArray<string>(["init1", "init2"]);
    clientToken = host.registerClient();
    host.track(alpha);

    const creationMessages = host.getMessages().get(clientToken)!;
    await client.applyAsync(creationMessages);
    alphaClient = client.findObjectOfType(SyncableObservableArray<string>)!;
  });

  async function transmitMessages() {
    const changeMessages = host.getMessages().get(clientToken)!;
    await client.applyAsync(changeMessages);
  }

  it("should report new items", async () => {
    let hasTwoNewItems = false;

    alphaClient.on("added", (items, start) => {
      hasTwoNewItems = items.length === 2;
    });

    alpha.push("value3", "value4");

    await transmitMessages();

    assert.ok(hasTwoNewItems);
  });

  it("should report removed items", async () => {
    let hasTwoRemovedItems = false;

    alphaClient.on("removed", (items, start) => {
      hasTwoRemovedItems = items.length === 2;
    });

    alpha.splice(0, 2);

    await transmitMessages();

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

    await transmitMessages();

    assert.ok(hasRemovedItem);
    assert.ok(hasTwoNewItems);
  });
});
