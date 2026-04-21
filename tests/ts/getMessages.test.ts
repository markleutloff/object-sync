import { ObjectSync, ClientToken, syncObject, syncProperty, Message } from "../../src/index.js";
import { describe, it, beforeEach } from "node:test";
import assert from "assert";

@syncObject()
class Item {
  @syncProperty()
  accessor value: number = 0;
}

describe("getMessages", () => {
  let host: ObjectSync;
  let clientTokenA: ClientToken;
  let clientTokenB: ClientToken;
  let clientTokenC: ClientToken;
  let trackedItem: Item;

  beforeEach(() => {
    host = new ObjectSync({ identity: "host" });
    clientTokenA = host.registerClient({ identity: "clientA" });
    clientTokenB = host.registerClient({ identity: "clientB" });
    clientTokenC = host.registerClient({ identity: "clientC" });

    trackedItem = new Item();
    trackedItem.value = 42;
    host.track(trackedItem);
  });

  describe("no arguments", () => {
    it("should return a Map with messages for all clients", () => {
      const result = host.getMessages();
      assert(result instanceof Map, "Expected a Map");
      assert(result.has(clientTokenA), "Missing clientA");
      assert(result.has(clientTokenB), "Missing clientB");
      assert(result.has(clientTokenC), "Missing clientC");
      assert(result.get(clientTokenA)!.length > 0, "clientA should have messages");
      assert(result.get(clientTokenB)!.length > 0, "clientB should have messages");
      assert(result.get(clientTokenC)!.length > 0, "clientC should have messages");
    });

    it("should clear states after retrieval", () => {
      host.getMessages();
      const result = host.getMessages();
      for (const [, messages] of result) {
        assert.strictEqual(messages.length, 0, "Expected no messages after second getMessages()");
      }
    });
  });

  describe("boolean argument (clearNonClientStates)", () => {
    it("should return a Map for all clients when passed true", () => {
      const result = host.getMessages(true);
      assert(result instanceof Map, "Expected a Map");
      assert.strictEqual(result.size, 3, "Expected 3 clients");
      for (const [, messages] of result) {
        assert(messages.length > 0, "Each client should have messages");
      }
    });

    it("should not clear states when passed false", () => {
      const first = host.getMessages(false);
      assert(first instanceof Map);
      for (const [, messages] of first) {
        assert(messages.length > 0, "First call should have messages");
      }

      // States not cleared, so calling again with a single client should still produce messages
      const second = host.getMessages(clientTokenA);
      assert(second.length > 0, "Second call should still have messages when clearNonClientStates was false");
    });
  });

  describe("single ClientToken", () => {
    it("should return Message[] for one client", () => {
      const result = host.getMessages(clientTokenA);
      assert(Array.isArray(result), "Expected an array");
      assert(result.length > 0, "Should have messages for clientA");
    });

    it("should clear all pending states by default", () => {
      host.getMessages(clientTokenA);
      // clearNonClientStates defaults to true, so global pending state is cleared
      const resultB = host.getMessages(clientTokenB);
      assert(Array.isArray(resultB));
      assert.strictEqual(resultB.length, 0, "clientB should have no messages after global clear");
    });

    it("should preserve other clients' states when clearNonClientStates is false", () => {
      host.getMessages(clientTokenA, false);
      const resultB = host.getMessages(clientTokenB);
      assert(Array.isArray(resultB));
      assert(resultB.length > 0, "clientB should still have messages");
    });
  });

  describe("array of ClientTokens", () => {
    it("should return a Map with messages only for the specified clients", () => {
      const result = host.getMessages([clientTokenA, clientTokenB]);
      assert(result instanceof Map, "Expected a Map");
      assert.strictEqual(result.size, 2, "Expected exactly 2 entries");
      assert(result.has(clientTokenA), "Missing clientA");
      assert(result.has(clientTokenB), "Missing clientB");
      assert(!result.has(clientTokenC), "clientC should not be in the result");
      assert(result.get(clientTokenA)!.length > 0, "clientA should have messages");
      assert(result.get(clientTokenB)!.length > 0, "clientB should have messages");
    });

    it("should clear all pending states by default", () => {
      host.getMessages([clientTokenA, clientTokenB]);
      // clearNonClientStates defaults to true, so clientC's pending state is also cleared
      const resultC = host.getMessages(clientTokenC);
      assert(Array.isArray(resultC));
      assert.strictEqual(resultC.length, 0, "clientC should have no messages after global clear");
    });

    it("should preserve other clients' states when clearNonClientStates is false", () => {
      host.getMessages([clientTokenA, clientTokenB], false);
      const resultC = host.getMessages(clientTokenC);
      assert(Array.isArray(resultC));
      assert(resultC.length > 0, "clientC should still have messages");
    });

    it("should return empty messages on second call for the same clients", () => {
      host.getMessages([clientTokenA, clientTokenB]);
      const second = host.getMessages([clientTokenA, clientTokenB]);
      assert(second instanceof Map);
      for (const [, messages] of second) {
        assert.strictEqual(messages.length, 0, "Expected no messages on second call");
      }
    });

    it("should work with a single-element array", () => {
      const result = host.getMessages([clientTokenA]);
      assert(result instanceof Map, "Expected a Map for single-element array");
      assert.strictEqual(result.size, 1);
      assert(result.get(clientTokenA)!.length > 0);
    });
  });

  describe("exchangeMessagesAsync with clients filter", () => {
    let clientSyncA: ObjectSync;
    let clientSyncB: ObjectSync;
    let clientSyncC: ObjectSync;
    let hostTokenFromA: ClientToken;
    let hostTokenFromB: ClientToken;
    let hostTokenFromC: ClientToken;

    beforeEach(() => {
      clientSyncA = new ObjectSync({ identity: "clientA", types: [Item] });
      clientSyncB = new ObjectSync({ identity: "clientB", types: [Item] });
      clientSyncC = new ObjectSync({ identity: "clientC", types: [Item] });
      hostTokenFromA = clientSyncA.registerClient({ identity: "host" });
      hostTokenFromB = clientSyncB.registerClient({ identity: "host" });
      hostTokenFromC = clientSyncC.registerClient({ identity: "host" });
    });

    const clientSyncs = () =>
      new Map<ClientToken, { sync: ObjectSync; hostToken: ClientToken }>([
        [clientTokenA, { sync: clientSyncA, hostToken: hostTokenFromA }],
        [clientTokenB, { sync: clientSyncB, hostToken: hostTokenFromB }],
        [clientTokenC, { sync: clientSyncC, hostToken: hostTokenFromC }],
      ]);

    it("should only exchange with the specified clients", async () => {
      const contacted = new Set<ClientToken>();
      await host.exchangeMessagesAsync({
        clients: [clientTokenA, clientTokenB],
        sendToClientAsync: async (clientToken, messages) => {
          contacted.add(clientToken);
          const client = clientSyncs().get(clientToken)!;
          await client.sync.applyMessagesAsync(messages, client.hostToken);
          return client.sync.getMessages(client.hostToken);
        },
      });

      assert(contacted.has(clientTokenA), "clientA should have been contacted");
      assert(contacted.has(clientTokenB), "clientB should have been contacted");
      assert(!contacted.has(clientTokenC), "clientC should NOT have been contacted");

      // clientA and clientB should have the item
      assert.notStrictEqual(clientSyncA.rootObjects.findOne(Item), undefined);
      assert.notStrictEqual(clientSyncB.rootObjects.findOne(Item), undefined);
      // clientC was excluded
      assert.strictEqual(clientSyncC.rootObjects.findOne(Item), undefined);
    });

    it("should clear all pending states so subsequent exchange has no messages", async () => {
      // Exchange with A and B — this clears global pending state
      await host.exchangeMessagesAsync({
        clients: [clientTokenA, clientTokenB],
        sendToClientAsync: async (clientToken, messages) => {
          const client = clientSyncs().get(clientToken)!;
          await client.sync.applyMessagesAsync(messages, client.hostToken);
          return client.sync.getMessages(client.hostToken);
        },
      });

      assert.notStrictEqual(clientSyncA.rootObjects.findOne(Item), undefined, "clientA should have item");
      assert.notStrictEqual(clientSyncB.rootObjects.findOne(Item), undefined, "clientB should have item");

      // C was not in the first exchange and state was cleared, so C gets nothing
      await host.exchangeMessagesAsync({
        clients: [clientTokenC],
        sendToClientAsync: async (clientToken, messages) => {
          const client = clientSyncs().get(clientToken)!;
          await client.sync.applyMessagesAsync(messages, client.hostToken);
          return client.sync.getMessages(client.hostToken);
        },
      });

      assert.strictEqual(clientSyncC.rootObjects.findOne(Item), undefined, "clientC should NOT have item — state was cleared");
    });
  });
});
