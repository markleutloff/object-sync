import { syncObject, syncProperty, ClientToken, ObjectSync } from "../../src/index.js";
import { describe, it, beforeEach } from "node:test";
import assert from "assert";

@syncObject()
class Root {
  @syncProperty()
  accessor value: number = 0;
}

type ObjectSyncAndClientToken = ObjectSync & {
  hostClientToken: ClientToken;
};

describe("ObjectSync multiple clients", () => {
  let hostObjectSync: ObjectSync;
  let clientObjectSyncs: Map<ClientToken, ObjectSyncAndClientToken> = new Map();

  let hostRoot: Root;
  let nextClientId = 0;

  async function exchangeMessagesAsync(): Promise<void> {
    await hostObjectSync.exchangeMessagesAsync({
      sendToClientAsync: async (clientToken, messages) => {
        const clientObjectSync = clientObjectSyncs.get(clientToken)!;
        await clientObjectSync.applyMessagesAsync(messages, clientObjectSync.hostClientToken);
        return clientObjectSync.getMessages(clientObjectSync.hostClientToken);
      },
    });
  }

  beforeEach(() => {
    const defaultSettings = {
      typeSerializers: [],
    };
    const hostSettings = {
      identity: "host",
      typeGenerators: [],
      ...defaultSettings,
    };

    hostObjectSync = new ObjectSync(hostSettings);
    for (let i = 0; i < 3; i++) {
      createClient();
    }

    function createClient() {
      const clientSettings = {
        identity: `client${nextClientId++}`,
        typeGenerators: [Root],
        ...defaultSettings,
      };
      const clientObjectSync = new ObjectSync(clientSettings);
      const result = clientObjectSync as ObjectSyncAndClientToken;
      result.hostClientToken = clientObjectSync.registerClient({ identity: "host" });

      const clientTokenForHost = hostObjectSync.registerClient({ identity: clientSettings.identity });
      clientObjectSyncs.set(clientTokenForHost, result);
      return result;
    }

    hostRoot = new Root();
    hostObjectSync.track(hostRoot);
  });

  it("should report creation to clients", async () => {
    hostRoot.value = 42;
    await exchangeMessagesAsync();

    for (const clientObjectSync of clientObjectSyncs.values()) {
      const clientRoot = clientObjectSync.rootObjects.findOne(Root)!;
      assert.notStrictEqual(clientRoot, hostRoot);
      assert.strictEqual(clientRoot.value, hostRoot.value);
    }
  });
});
