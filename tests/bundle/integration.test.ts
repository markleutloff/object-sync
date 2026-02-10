import { ObjectSync, SyncableArray, ClientToken, syncObject, ObjectSyncSettings, ExtendedSyncAgent, CreateObjectMessage, Message, syncAgent } from "../../dist/index.js";

import { describe, it, beforeEach } from "node:test";
import assert from "assert";

@syncObject({ typeId: "Beta" })
class Beta {}

class CustomClass {
  value: string;

  constructor(value: string) {
    this.value = value;
  }
}

@syncAgent({
  typeId: "CustomClass",
  type: CustomClass,
})
class CustomClassSyncAgent extends ExtendedSyncAgent<CustomClass, string, string> {
  onCreateMessageReceived(message: CreateObjectMessage<string>, clientToken: ClientToken): void {
    this.instance = new CustomClass(message.data);
  }
  getTypeId(clientToken: ClientToken): string | null {
    return "CustomClass";
  }
  generateMessages(clientToken: ClientToken, isNewClient: boolean): Message[] {
    if (isNewClient) return [this.createMessage("create", this.instance.value, clientToken)];

    return [];
  }
}

describe("ObjectSync client-host integration (SyncableArray)", () => {
  let alpha: SyncableArray<string>;

  let hostObjectSync: ObjectSync;
  let clientObjectSync: ObjectSync;
  let clientObjectSyncClientToken: ClientToken;
  let hostObjectSyncClientToken: ClientToken;

  beforeEach(() => {
    const hostSettings: ObjectSyncSettings = {
      identity: "host",
    };

    const clientSettings: ObjectSyncSettings = {
      identity: "client",
    };

    hostObjectSync = new ObjectSync(hostSettings);
    clientObjectSync = new ObjectSync(clientSettings);

    clientObjectSyncClientToken = hostObjectSync.registerClient({ identity: "client" });
    hostObjectSyncClientToken = clientObjectSync.registerClient({ identity: "host" });

    alpha = new SyncableArray<string>("init1", "init2");
    hostObjectSync.track(alpha);
  });

  it("should create array", async () => {
    const creationMessages = hostObjectSync.getMessages().get(clientObjectSyncClientToken)!;
    await clientObjectSync.applyMessagesAsync(creationMessages, hostObjectSyncClientToken);

    const alphaClient = clientObjectSync.rootObjects.findOne(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha, alphaClient);
  });

  it("should transfer push changes", async () => {
    const creationMessages = hostObjectSync.getMessages().get(clientObjectSyncClientToken)!;
    await clientObjectSync.applyMessagesAsync(creationMessages, hostObjectSyncClientToken);

    alpha.push("value3", "value4");
    const changeMessages = hostObjectSync.getMessages().get(clientObjectSyncClientToken)!;
    await clientObjectSync.applyMessagesAsync(changeMessages, hostObjectSyncClientToken);

    const alphaClient = clientObjectSync.rootObjects.findOne(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha, alphaClient);
  });

  it("should transfer splice remove changes", async () => {
    const creationMessages = hostObjectSync.getMessages().get(clientObjectSyncClientToken)!;
    await clientObjectSync.applyMessagesAsync(creationMessages, hostObjectSyncClientToken);

    alpha.splice(0, 1);

    const changeMessages = hostObjectSync.getMessages().get(clientObjectSyncClientToken)!;
    await clientObjectSync.applyMessagesAsync(changeMessages, hostObjectSyncClientToken);

    const alphaClient = clientObjectSync.rootObjects.findOne(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha, alphaClient);
  });

  it("should should merge push messages", async () => {
    const creationMessages = hostObjectSync.getMessages().get(clientObjectSyncClientToken)!;
    await clientObjectSync.applyMessagesAsync(creationMessages, hostObjectSyncClientToken);

    alpha.push("value3", "value4");
    alpha.push("value5");
    alpha.push("value6");
    alpha.push("value7");
    alpha.push("value8", "value9");

    const changeMessages = hostObjectSync.getMessages().get(clientObjectSyncClientToken)!;
    await clientObjectSync.applyMessagesAsync(changeMessages, hostObjectSyncClientToken);

    const alphaClient = clientObjectSync.rootObjects.findOne(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha, alphaClient);
  });

  it("should transfer intersecting push and remove changes", async () => {
    const creationMessages = hostObjectSync.getMessages().get(clientObjectSyncClientToken)!;
    await clientObjectSync.applyMessagesAsync(creationMessages, hostObjectSyncClientToken);

    alpha.push("value3", "value4");
    alpha.splice(3, 1);
    alpha.splice(1, 2);

    const changeMessages = hostObjectSync.getMessages().get(clientObjectSyncClientToken)!;
    await clientObjectSync.applyMessagesAsync(changeMessages, hostObjectSyncClientToken);

    const alphaClient = clientObjectSync.rootObjects.findOne(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha, alphaClient);
  });

  it("should transfer only a single push change", async () => {
    const creationMessages = hostObjectSync.getMessages().get(clientObjectSyncClientToken)!;
    await clientObjectSync.applyMessagesAsync(creationMessages, hostObjectSyncClientToken);
    const alphaClient = clientObjectSync.rootObjects.findOne(SyncableArray<string>)!;

    alpha.push("value3", "toBeRemoved", "value5");
    // remove toBeRemoved
    alpha.splice(3, 1);

    const changeMessages = hostObjectSync.getMessages().get(clientObjectSyncClientToken)!;
    await clientObjectSync.applyMessagesAsync(changeMessages, hostObjectSyncClientToken);

    assert.deepStrictEqual(alpha, alphaClient);
  });

  it("should clear the array", async () => {
    const creationMessages = hostObjectSync.getMessages().get(clientObjectSyncClientToken)!;
    await clientObjectSync.applyMessagesAsync(creationMessages, hostObjectSyncClientToken);

    alpha.length = 0;
    assert.equal(alpha.length, 0);

    const changeMessages = hostObjectSync.getMessages().get(clientObjectSyncClientToken)!;
    await clientObjectSync.applyMessagesAsync(changeMessages, hostObjectSyncClientToken);

    const alphaClient = clientObjectSync.rootObjects.findOne(SyncableArray<string>)!;
    assert.deepStrictEqual(alpha, alphaClient);
  });

  it("should handle transferable items", async () => {
    const beta = new Beta();
    alpha.length = 0;
    alpha[0] = beta as any;
    const creationMessages = hostObjectSync.getMessages().get(clientObjectSyncClientToken)!;
    await clientObjectSync.applyMessagesAsync(creationMessages, hostObjectSyncClientToken);

    const betaClient = clientObjectSync.allObjects.findOne(Beta)!;
    assert.notEqual(betaClient, null);
  });

  it("should serialize a custom class", async () => {
    hostObjectSync = new ObjectSync({
      identity: "host",
      types: [CustomClass],
    });
    clientObjectSync = new ObjectSync({
      identity: "client",
      types: [CustomClass],
    });

    clientObjectSyncClientToken = hostObjectSync.registerClient({ identity: "client" });
    hostObjectSyncClientToken = clientObjectSync.registerClient({ identity: "host" });

    const custom = new CustomClass("customValue");
    hostObjectSync.track(custom);

    const messages = hostObjectSync.getMessages().get(clientObjectSyncClientToken)!;
    await clientObjectSync.applyMessagesAsync(messages, hostObjectSyncClientToken);

    const customClient = clientObjectSync.rootObjects.findOne(CustomClass)!;
    assert.notEqual(customClient, null);
  });
});
