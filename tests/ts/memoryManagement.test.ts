import { ObjectSync, ClientToken, syncObject, syncProperty, Message, ChangeObjectMessage, nothing, MemoryManagementMode } from "../../src/index.js";
import { describe, it, beforeEach } from "node:test";
import assert from "assert";

@syncObject({ typeId: "Alpha" })
class Alpha {
  @syncProperty()
  public accessor beta: Beta | null = null;

  @syncProperty({
    beforeSendToClient({ destinationClientToken, value }) {
      if (destinationClientToken.identity === "client1") {
        return nothing;
      }
      return value;
    },
  })
  public accessor betaButNotForClient1: Beta | null = null;
}

@syncObject({ typeId: "Beta" })
class Beta {
  @syncProperty()
  public accessor value: string = "default";
}

type ClientInfo = {
  objectSync: ObjectSync;
  clientTokenFromSource: ClientToken;
  sourceClientTokenFromClient: ClientToken;
};
describe("MemoryManagement", () => {
  let sourceSync: ObjectSync = null!;
  let clients: ClientInfo[] = [];

  beforeEach(() => {
    sourceSync = null!;
    clients = [];
  });

  const sendDataToClients = async () => {
    const messagesSend: Map<ClientInfo, Message[]> = new Map();
    for (const client of clients) {
      const messages = sourceSync!.getMessages(client.clientTokenFromSource, false);
      messagesSend.set(client, messages);
      await client.objectSync.applyMessagesAsync(messages, client.sourceClientTokenFromClient);
    }
    sourceSync!.clearStates();
    return messagesSend;
  };

  const createClientSync = () => {
    const objectSync = new ObjectSync({
      identity: `client${clients.length}`,
    });
    const sourceClientTokenFromClient = objectSync.registerClient({ identity: "source" });
    const clientTokenFromSource = sourceSync!.registerClient({ identity: `client${clients.length}` });

    const clientInfo: ClientInfo = { objectSync, sourceClientTokenFromClient, clientTokenFromSource };
    clients.push(clientInfo);
    return clientInfo;
  };

  const createSourceSync = (memoryManagementMode: MemoryManagementMode) => {
    sourceSync = new ObjectSync({
      identity: "source",
      memoryManagementMode: memoryManagementMode,
    });
  };

  it("should send delete messages when object is unused but not yet garbage collected", async () => {
    createSourceSync("byClient");
    const client0 = createClientSync();

    const alpha = new Alpha();
    let beta: Beta | null = new Beta();
    alpha.beta = beta;
    sourceSync.track(alpha, "alpha");

    let messages = (await sendDataToClients()).get(client0)!;
    const betaObjectId = messages.filter((m) => m.type === "create" && m.objectId !== "alpha")[0].objectId;

    alpha.beta = null;
    messages = (await sendDataToClients()).get(client0)!;
    let deleteMessages = messages.filter((m) => m.type === "delete");
    assert(deleteMessages.length === 1, "Delete messages should be sent to dest");
    alpha.beta = beta;
    messages = (await sendDataToClients()).get(client0)!;
    const createMessages = messages.filter((m) => m.type === "create");

    assert(createMessages.length === 1, "Create messages should be sent to dest");
    const createMessage = messages.find((m) => m.type === "change" && m.objectId === "alpha") as ChangeObjectMessage<any>;
    assert(createMessage.data.beta.objectId !== betaObjectId, "Beta objectId should not match");
  });

  it("should not send delete messages when object is unused but not yet garbage collected", async () => {
    createSourceSync("weak");
    const client0 = createClientSync();

    const alpha = new Alpha();
    let beta: Beta | null = new Beta();
    alpha.beta = beta;
    sourceSync.track(alpha, "alpha");

    let messages = (await sendDataToClients()).get(client0)!;
    const betaObjectId = messages.filter((m) => m.type === "create" && m.objectId !== "alpha")[0].objectId;

    alpha.beta = null;
    messages = (await sendDataToClients()).get(client0)!;
    let deleteMessages = messages.filter((m) => m.type === "delete");
    assert(deleteMessages.length === 0, "No delete messages should be sent to dest");
    alpha.beta = beta;
    messages = (await sendDataToClients()).get(client0)!;
    const createMessages = messages.filter((m) => m.type === "create");

    assert(createMessages.length === 0, "No create messages should be sent to dest");
    const changeMessage = messages.find((m) => m.type === "change" && m.objectId === "alpha") as ChangeObjectMessage<any>;
    assert(changeMessage.data.beta.objectId === betaObjectId, "Beta objectId should match");
  });

  it("should only send delete messages to the affected clients", async () => {
    createSourceSync("byClient");
    const client0 = createClientSync();
    const client1 = createClientSync();

    const alpha = new Alpha();
    let beta: Beta | null = new Beta();
    alpha.beta = beta;
    alpha.betaButNotForClient1 = beta;
    sourceSync.track(alpha, "alpha");

    await sendDataToClients();
    alpha.beta = null;
    beta = null;

    let messagesByClient = await sendDataToClients();
    let deleteMessagesClient0 = messagesByClient.get(client0)!.filter((m) => m.type === "delete");
    assert(deleteMessagesClient0.length === 0, "Delete message should not be sent to client0");
    let deleteMessagesClient1 = messagesByClient.get(client1)!.filter((m) => m.type === "delete");
    assert(deleteMessagesClient1.length === 1, "Delete message should be sent to client1 only");

    alpha.betaButNotForClient1 = null;

    messagesByClient = await sendDataToClients();
    deleteMessagesClient0 = messagesByClient.get(client0)!.filter((m) => m.type === "delete");
    assert(deleteMessagesClient0.length === 1, "Delete message should be sent to client0");
    deleteMessagesClient1 = messagesByClient.get(client1)!.filter((m) => m.type === "delete");
    assert(deleteMessagesClient1.length === 0, "Delete message should not be sent to client1 only");
  });

  it("should send delete message when object is garbage collected", async () => {
    createSourceSync("weak");
    const client0 = createClientSync();

    const alpha = new Alpha();
    let beta: Beta | null = new Beta();
    alpha.beta = beta;
    sourceSync.track(alpha, "alpha");

    await sendDataToClients();
    alpha.beta = null;
    beta = null;

    for (let i = 0; i < 100; ++i) {
      const messages = (await sendDataToClients()).get(client0)!;
      const deleteMessages = messages.filter((m) => m.type === "delete");
      if (deleteMessages.length > 0) return;
      await delayAsync(100); // wait for finalization registry to run
    }

    assert.fail("Beta object was not garbage collected and deleted after waiting 10 seconds");
  });
});

function delayAsync(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
