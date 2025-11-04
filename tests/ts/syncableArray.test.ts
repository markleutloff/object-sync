import { SyncableArray, ClientConnection, syncObject } from "../../src/index.js";
import { describe, it, beforeEach } from "node:test";
import assert from "assert";
import { ObjectSyncHost, ObjectSyncClient } from "../../src/index.js";

@syncObject({ typeId: "Beta" })
class Beta {}

describe("ObjectSync client-host integration (SyncableArray)", () => {
  let host: ObjectSyncHost;
  let client: ObjectSyncClient;
  let alpha: SyncableArray<string>;
  let clientToken: ClientConnection;

  beforeEach(() => {
    host = new ObjectSyncHost();
    client = new ObjectSyncClient();
    alpha = new SyncableArray<string>(["init1", "init2"]);
    clientToken = host.registerClient();
    host.track(alpha);
  });

  it("should create array", async () => {
    const creationMessages = host.getMessages().get(clientToken)!;
    await client.applyAsync(creationMessages);

    const alphaClient = client.findObjectOfType(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha.value, alphaClient.value);
  });

  it("should transfer push changes", async () => {
    const creationMessages = host.getMessages().get(clientToken)!;
    await client.applyAsync(creationMessages);

    alpha.push("value3", "value4");
    const changeMessages = host.getMessages().get(clientToken)!;
    await client.applyAsync(changeMessages);

    const alphaClient = client.findObjectOfType(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha.value, alphaClient.value);
  });

  it("should transfer splice remove changes", async () => {
    const creationMessages = host.getMessages().get(clientToken)!;
    await client.applyAsync(creationMessages);

    alpha.splice(0, 1);

    const changeMessages = host.getMessages().get(clientToken)!;
    await client.applyAsync(changeMessages);

    const alphaClient = client.findObjectOfType(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha.value, alphaClient.value);
  });

  it("should should merge push messages", async () => {
    const creationMessages = host.getMessages().get(clientToken)!;
    await client.applyAsync(creationMessages);

    alpha.push("value3", "value4");
    alpha.push("value5");
    alpha.push("value6");
    alpha.push("value7");
    alpha.push("value8", "value9");

    const changeMessages = host.getMessages().get(clientToken)!;
    await client.applyAsync(changeMessages);

    const alphaClient = client.findObjectOfType(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha.value, alphaClient.value);
  });

  it("should transfer intersecting push and remove changes", async () => {
    const creationMessages = host.getMessages().get(clientToken)!;
    await client.applyAsync(creationMessages);

    alpha.push("value3", "value4");
    alpha.splice(3, 1);
    alpha.splice(1, 2);

    const changeMessages = host.getMessages().get(clientToken)!;
   await client.applyAsync(changeMessages);

    const alphaClient = client.findObjectOfType(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha.value, alphaClient.value);
  });

  it("should transfer only a single push change", async () => {
    const creationMessages = host.getMessages().get(clientToken)!;
    await client.applyAsync(creationMessages);
    const alphaClient = client.findObjectOfType(SyncableArray<string>)!;

    alpha.push("value3", "toBeRemoved", "value5");
    // remove toBeRemoved
    alpha.splice(3, 1);

    const changeMessages = host.getMessages().get(clientToken)!;
    await client.applyAsync(changeMessages);

    assert.deepStrictEqual(alpha.value, alphaClient.value);
  });

  it("should clear the array", async () => {
    const creationMessages = host.getMessages().get(clientToken)!;
    await client.applyAsync(creationMessages);

    alpha.clear();
    assert.equal(alpha.length, 0);

    const changeMessages = host.getMessages().get(clientToken)!;
    await client.applyAsync(changeMessages);

    const alphaClient = client.findObjectOfType(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha.value, alphaClient.value);
  });

  it("should handle transferable items", async () => {
    const beta = new Beta();
    alpha.value = [beta] as any;
    const creationMessages = host.getMessages().get(clientToken)!;
    await client.applyAsync(creationMessages);

    const betaClient = client.findObjectOfType(Beta)!;
    assert.notEqual(betaClient, null);
  });
});
