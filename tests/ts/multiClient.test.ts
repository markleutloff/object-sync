import { syncMethod, syncObject, syncProperty, ClientConnection, ObjectSync } from "../../src/index.js";
import { describe, it, beforeEach } from "node:test";
import assert from "assert";

@syncObject()
class Root {
  @syncProperty()
  accessor value: number = 0;
}

type ObjectSyncAndClientConnection = ObjectSync & {
  hostClientConnection: ClientConnection;
};

describe("ObjectSync multiple clients", () => {
  let hostObjectSync: ObjectSync;
  let clientObjectSyncs: Map<ClientConnection, ObjectSyncAndClientConnection> = new Map();

  let hostRoot: Root;
  let nextClientId = 0;

  async function exchangeMessagesAsync(): Promise<void> {
    hostObjectSync.exchangeMessagesAsync(async (clientConnection, messages) => {
      const clientObjectSync = clientObjectSyncs.get(clientConnection)!;
      return clientObjectSync.applyMessagesFromClientAsync(clientObjectSync.hostClientConnection, messages);
    });

    for (const [clientConnection, clientObjectSync] of clientObjectSyncs) {
      await clientObjectSync.exchangeMessagesAsync(async (targetClientConnection /* we only target the host */, messages) => {
        return hostObjectSync.applyMessagesFromClientAsync(clientConnection, messages);
      });
    }
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
      const result = clientObjectSync as ObjectSyncAndClientConnection;
      result.hostClientConnection = clientObjectSync.registerClient({ identity: "host" });

      const clientConnectionForHost = hostObjectSync.registerClient({ identity: clientSettings.identity });
      clientObjectSyncs.set(clientConnectionForHost, result);
      return result;
    }

    hostRoot = new Root();
    hostObjectSync.track(hostRoot);
  });

  it("should report creation to clients", async () => {
    hostRoot.value = 42;
    await exchangeMessagesAsync();

    for (const clientObjectSync of clientObjectSyncs.values()) {
      const clientRoot = clientObjectSync.findObjectOfType(Root)!;
      assert.notStrictEqual(clientRoot, hostRoot);
      assert.strictEqual(clientRoot.value, hostRoot.value);
    }
  });
});
