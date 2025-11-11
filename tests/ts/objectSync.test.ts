import { syncMethod, syncObject, syncProperty, ClientConnection, ObjectSync, getHostObjectInfo, nothing, TypeSerializer } from "../../src/index.js";
import { describe, it, beforeEach } from "node:test";
import assert from "assert";

@syncObject({
  beforeSendToClient(object, constructor, typeId, clientConnection) {
    return object.syncAsClientRoot ? ClientRoot : typeId;
  }
})
class Root {
  syncAsClientRoot = false;
  allowValueMutation = false;

  @syncProperty({
    beforeSendToClient(object, key, value, clientConnection) {
      if (clientConnection.identity === "host") {
        return nothing;
      }
      if (object.allowValueMutation && key === "value") {
        return value + value;
      }
      return value;
    },
    canApply(object, key, clientConnection) {
      if (clientConnection.identity === "host") {
        return false;
      }
      return true;
    },
  })
  accessor value: number = 0;

  @syncProperty()
  accessor testClass: SerializableClass | undefined;

  @syncMethod()
  async invoke(value: number): Promise<number> {
    return value + value;
  }
}

@syncObject({})
class ClientRoot {
  @syncProperty()
  accessor value: number = 0;
}

class SerializableClass {
  #value: number;

  constructor(value: number = 0) {
    this.#value = value;
  }

  get value(): number {
    return this.#value;
  }
}

describe("ObjectSync client-host integration (objectSync)", () => {
  let hostObjectSync: ObjectSync;
  let clientObjectSync: ObjectSync;
  let clientObjectSyncClientConnection: ClientConnection;
  let hostObjectSyncClientConnection: ClientConnection;

  let hostRoot: Root;

  beforeEach(() => {
    const serializableClassSerializer: TypeSerializer<SerializableClass> = {
      typeId: "SerializableClass",
      type: SerializableClass,
      serialize: (obj: SerializableClass) => ({ value: obj.value }),
      deserialize: (data: any) => new SerializableClass(data.value),
    };
    const defaultSettings = {
      typeSerializers: [serializableClassSerializer],
    };
    const hostSettings = {
      identity: "host",
      typeGenerators: [],
      ...defaultSettings,
    };

    const clientSettings = {
      identity: "client",
      typeGenerators: [Root, ClientRoot],
      ...defaultSettings,
    };

    hostObjectSync = new ObjectSync(hostSettings);
    clientObjectSync = new ObjectSync(clientSettings);

    clientObjectSyncClientConnection = hostObjectSync.tracker.registerClient({ identity: "client" });
    hostObjectSyncClientConnection = clientObjectSync.tracker.registerClient({ identity: "host" });

    hostRoot = new Root();
    hostObjectSync.tracker.track(hostRoot);
  });

  it("should report creation to client", async () => {
    hostRoot.value = 42;
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);

    const clientRoot = clientObjectSync.applicator.findObjectOfType(Root)!;
    assert.notStrictEqual(clientRoot, hostRoot);
    assert.strictEqual(clientRoot.value, hostRoot.value);
  });

  it("should report changes to client", async () => {
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);
    const clientRoot = clientObjectSync.applicator.findObjectOfType(Root)!;

    assert.strictEqual(clientRoot.value, hostRoot.value);

    hostRoot.value = 100;
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);
    assert.strictEqual(clientRoot.value, hostRoot.value);
  });

  it("should execute methods on client", async () => {
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);
    const clientRoot = clientObjectSync.applicator.findObjectOfType(Root)!;

    const invokeArgument = 55;
    const expectedHostResult = invokeArgument + invokeArgument;

    const { clientResults, hostResult } = getHostObjectInfo(hostRoot)!.invoke("invoke", invokeArgument);

    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);
    const clientInvokeResults = await clientResults;
    const clientResult = await clientInvokeResults.get(clientObjectSyncClientConnection)!;
    const hostResultValue = await hostResult;

    assert.strictEqual(hostResultValue, expectedHostResult);
    assert.strictEqual(clientResult, expectedHostResult);
  });

  it("should send anything to the host", async () => {
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);
    const clientRoot = clientObjectSync.applicator.findObjectOfType(Root)!;

    const oldHostValue = hostRoot.value;
    clientRoot.value = 77;

    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);
    assert.strictEqual(hostRoot.value, oldHostValue);
  });

  it("should sync serializable types", async () => {
    hostRoot.testClass = new SerializableClass(123);
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);

    const clientRoot = clientObjectSync.applicator.findObjectOfType(Root)!;
    assert.notStrictEqual(clientRoot.testClass, hostRoot.testClass);
    assert.strictEqual(clientRoot.testClass!.value, hostRoot.testClass!.value);
  });

  it("should sync a different type to the client", async () => {
    hostRoot.value = 42;
    hostRoot.syncAsClientRoot = true;
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);

    const clientRoot = clientObjectSync.applicator.findObjectOfType(ClientRoot)!;
    assert.notStrictEqual(clientRoot, hostRoot);
    assert.strictEqual(clientRoot.value, hostRoot.value);
  });

  it("it should send a different value than the original value to the client", async () => {
    hostRoot.value = 42;
    hostRoot.allowValueMutation = true;
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);

    const clientRoot = clientObjectSync.applicator.findObjectOfType(Root)!;
    assert.notStrictEqual(clientRoot.value, hostRoot.value);
  });
});

async function exchangeMessagesAsync(objectSync0: ObjectSync, objectSync1: ObjectSync): Promise<void> {
  await objectSync0.exchangeMessagesBulkAsync((messagesByClient) => {
    return objectSync1.applyMessagesAsync(messagesByClient);
  });

  await objectSync1.exchangeMessagesBulkAsync((messagesByClient) => {
    return objectSync0.applyMessagesAsync(messagesByClient);
  });
}
