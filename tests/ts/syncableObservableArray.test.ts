import { ObjectSync, SyncableObservableArray, ClientConnection, syncObject } from "../../src/index.js";
import { describe, it, beforeEach } from "node:test";
import assert from "assert";

@syncObject({ typeId: "Beta" })
class Beta {}

describe("ObjectSync client-host integration (SyncableArray)", () => {
  let hostObjectSync: ObjectSync;
  let clientObjectSync: ObjectSync;
  let clientObjectSyncClientConnection: ClientConnection;
  let hostObjectSyncClientConnection: ClientConnection;

  let alpha: SyncableObservableArray<string>;
  let alphaClient: SyncableObservableArray<string>;

  beforeEach(async () => {
    const hostSettings = {
      identity: "host",
      typeGenerators: [],
    };

    const clientSettings = {
      identity: "client",
      typeGenerators: [Beta, SyncableObservableArray],
    };

    hostObjectSync = new ObjectSync(hostSettings);
    clientObjectSync = new ObjectSync(clientSettings);

    clientObjectSyncClientConnection = hostObjectSync.tracker.registerClient({ identity: "client" });
    hostObjectSyncClientConnection = clientObjectSync.tracker.registerClient({ identity: "host" });

    alpha = new SyncableObservableArray<string>(["init1", "init2"]);
    hostObjectSync.tracker.track(alpha);

    await transmitMessages();
    alphaClient = clientObjectSync.applicator.findObjectOfType(SyncableObservableArray<string>)!;
  });

  async function transmitMessages() {
    const changeMessages = hostObjectSync.tracker.getMessages().get(clientObjectSyncClientConnection)!;
    await clientObjectSync.applicator.applyAsync(changeMessages, hostObjectSyncClientConnection);
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
