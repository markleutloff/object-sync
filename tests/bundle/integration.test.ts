import { ObjectSync, SyncableArray, ClientConnection, syncObject } from "../../dist/index.js";

import { describe, it, beforeEach } from "node:test";
import assert from "assert";

@syncObject({ typeId: "Beta" })
class Beta {}

describe("ObjectSync client-host integration (SyncableArray)", () => {
  let alpha: SyncableArray<string>;

  let hostObjectSync: ObjectSync;
  let clientObjectSync: ObjectSync;
  let clientObjectSyncClientConnection: ClientConnection;
  let hostObjectSyncClientConnection: ClientConnection;

  beforeEach(() => {
    const hostSettings = {
      identity: "host",
      typeGenerators: [],
    };

    const clientSettings = {
      identity: "client",
      typeGenerators: [Beta, SyncableArray],
    };

    hostObjectSync = new ObjectSync(hostSettings);
    clientObjectSync = new ObjectSync(clientSettings);

    clientObjectSyncClientConnection = hostObjectSync.registerClient({ identity: "client" });
    hostObjectSyncClientConnection = clientObjectSync.registerClient({ identity: "host" });

    alpha = new SyncableArray<string>(["init1", "init2"]);
    hostObjectSync.track(alpha);
  });

  it("should create array", async () => {
    const creationMessages = hostObjectSync.getMessages().get(clientObjectSyncClientConnection)!;
    await clientObjectSync.applyAsync(creationMessages, hostObjectSyncClientConnection);

    const alphaClient = clientObjectSync.findObjectOfType(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha.value, alphaClient.value);
  });

  it("should transfer push changes", async () => {
    const creationMessages = hostObjectSync.getMessages().get(clientObjectSyncClientConnection)!;
    await clientObjectSync.applyAsync(creationMessages, hostObjectSyncClientConnection);

    alpha.push("value3", "value4");
    const changeMessages = hostObjectSync.getMessages().get(clientObjectSyncClientConnection)!;
    await clientObjectSync.applyAsync(changeMessages, hostObjectSyncClientConnection);

    const alphaClient = clientObjectSync.findObjectOfType(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha.value, alphaClient.value);
  });

  it("should transfer splice remove changes", async () => {
    const creationMessages = hostObjectSync.getMessages().get(clientObjectSyncClientConnection)!;
    await clientObjectSync.applyAsync(creationMessages, hostObjectSyncClientConnection);

    alpha.splice(0, 1);

    const changeMessages = hostObjectSync.getMessages().get(clientObjectSyncClientConnection)!;
    await clientObjectSync.applyAsync(changeMessages, hostObjectSyncClientConnection);

    const alphaClient = clientObjectSync.findObjectOfType(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha.value, alphaClient.value);
  });

  it("should should merge push messages", async () => {
    const creationMessages = hostObjectSync.getMessages().get(clientObjectSyncClientConnection)!;
    await clientObjectSync.applyAsync(creationMessages, hostObjectSyncClientConnection);

    alpha.push("value3", "value4");
    alpha.push("value5");
    alpha.push("value6");
    alpha.push("value7");
    alpha.push("value8", "value9");

    const changeMessages = hostObjectSync.getMessages().get(clientObjectSyncClientConnection)!;
    await clientObjectSync.applyAsync(changeMessages, hostObjectSyncClientConnection);

    const alphaClient = clientObjectSync.findObjectOfType(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha.value, alphaClient.value);
  });

  it("should transfer intersecting push and remove changes", async () => {
    const creationMessages = hostObjectSync.getMessages().get(clientObjectSyncClientConnection)!;
    await clientObjectSync.applyAsync(creationMessages, hostObjectSyncClientConnection);

    alpha.push("value3", "value4");
    alpha.splice(3, 1);
    alpha.splice(1, 2);

    const changeMessages = hostObjectSync.getMessages().get(clientObjectSyncClientConnection)!;
    await clientObjectSync.applyAsync(changeMessages, hostObjectSyncClientConnection);

    const alphaClient = clientObjectSync.findObjectOfType(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha.value, alphaClient.value);
  });

  it("should transfer only a single push change", async () => {
    const creationMessages = hostObjectSync.getMessages().get(clientObjectSyncClientConnection)!;
    await clientObjectSync.applyAsync(creationMessages, hostObjectSyncClientConnection);
    const alphaClient = clientObjectSync.findObjectOfType(SyncableArray<string>)!;

    alpha.push("value3", "toBeRemoved", "value5");
    // remove toBeRemoved
    alpha.splice(3, 1);

    const changeMessages = hostObjectSync.getMessages().get(clientObjectSyncClientConnection)!;
    await clientObjectSync.applyAsync(changeMessages, hostObjectSyncClientConnection);

    assert.deepStrictEqual(alpha.value, alphaClient.value);
  });

  it("should clear the array", async () => {
    const creationMessages = hostObjectSync.getMessages().get(clientObjectSyncClientConnection)!;
    await clientObjectSync.applyAsync(creationMessages, hostObjectSyncClientConnection);

    alpha.clear();
    assert.equal(alpha.length, 0);

    const changeMessages = hostObjectSync.getMessages().get(clientObjectSyncClientConnection)!;
    await clientObjectSync.applyAsync(changeMessages, hostObjectSyncClientConnection);

    const alphaClient = clientObjectSync.findObjectOfType(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha.value, alphaClient.value);
  });

  it("should handle transferable items", async () => {
    const beta = new Beta();
    alpha.value = [beta] as any;
    const creationMessages = hostObjectSync.getMessages().get(clientObjectSyncClientConnection)!;
    await clientObjectSync.applyAsync(creationMessages, hostObjectSyncClientConnection);

    const betaClient = clientObjectSync.findObjectOfType(Beta)!;
    assert.notEqual(betaClient, null);
  });
});
