import { syncMethod, syncObject, syncProperty, ClientConnection, ObjectSync, nothing, TypeSerializer, getTrackerObjectInfo } from "../../src/index.js";
import { describe, it, beforeEach } from "node:test";
import assert from "assert";

@syncObject()
class SubTrackable {}

@syncObject({
  beforeSendToClient({ instance, constructor, typeId, destinationClientConnection }) {
    return instance.syncAsClientRoot ? ClientRoot : typeId;
  },
})
class Root {
  syncAsClientRoot = false;
  allowValueMutation = false;

  @syncProperty({
    beforeSendToClient({ instance, key, value, destinationClientConnection }) {
      if (destinationClientConnection.identity === "host") {
        return nothing;
      }
      if (instance.allowValueMutation && key === "value") {
        return value + value;
      }
      return value;
    },
    canApply({ sourceClientConnection }) {
      if (sourceClientConnection.identity === "host") {
        return false;
      }
      return true;
    },
  })
  accessor value: number = 0;

  @syncProperty({
    canTrack() {
      return false;
    },
  })
  accessor untrackedValue: number = 0;

  @syncProperty()
  accessor testClass: SerializableClass | undefined;

  @syncProperty()
  accessor array: SubTrackable[] = [];

  @syncMethod()
  async invoke(value: number): Promise<number> {
    return value + value;
  }

  @syncMethod()
  invokeSync(value: number): number {
    return value + value;
  }
}

@syncObject({})
class ClientRoot {
  @syncProperty()
  accessor value: number = 0;
}

@syncObject({})
class ClassWithSubClass {
  @syncProperty()
  accessor value: ClientRoot = new ClientRoot();
}

@syncObject({
  beforeSendToClient(payload) {
    return nothing;
  },
})
class NonOnClientClass {
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
      typeGenerators: [Root, ClientRoot, ClassWithSubClass, SubTrackable],
      ...defaultSettings,
    };

    hostObjectSync = new ObjectSync(hostSettings);
    clientObjectSync = new ObjectSync(clientSettings);

    clientObjectSyncClientConnection = hostObjectSync.registerClient({ identity: "client" });
    hostObjectSyncClientConnection = clientObjectSync.registerClient({ identity: "host" });

    hostRoot = new Root();
    hostObjectSync.track(hostRoot);
  });

  it("should report creation to client", async () => {
    hostRoot.value = 42;
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);

    const clientRoot = clientObjectSync.findObjectOfType(Root)!;
    assert.notStrictEqual(clientRoot, hostRoot);
    assert.strictEqual(clientRoot.value, hostRoot.value);
  });

  it("should report deletion to client", async () => {
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);
    const clientRoot = clientObjectSync.findObjectOfType(Root)!;

    hostObjectSync.untrack(hostRoot);
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);

    const clientRoot2 = clientObjectSync.findObjectOfType(Root);
    assert.notStrictEqual(clientRoot, clientRoot2);
    assert.strictEqual(clientRoot2, null);
  });

  it("should handle native array", async () => {
    hostRoot.array = [new SubTrackable(), new SubTrackable()];
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);
    const clientRoot = clientObjectSync.findObjectOfType(Root)!;

    assert.strictEqual(clientRoot.array.length, 2);
    assert.strictEqual(clientRoot.array[0] instanceof SubTrackable, true);
    assert.strictEqual(clientRoot.array[0] instanceof SubTrackable, true);
    assert.notStrictEqual(clientRoot.array[0], hostRoot.array[0]);
    assert.notStrictEqual(clientRoot.array[1], hostRoot.array[1]);
  });

  it("should report sub tracked classes", async () => {
    const classWithSubClass = new ClassWithSubClass();
    hostObjectSync.track(classWithSubClass);

    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);

    const clientClassWithSubClass = clientObjectSync.findObjectOfType(ClassWithSubClass)!;
    assert.notStrictEqual(clientClassWithSubClass, classWithSubClass);

    const clientSubClass = clientClassWithSubClass.value;
    assert.equal(!!clientSubClass, true);
  });

  it("should ignore changes and method calls when class will not be created on client", async () => {
    const nonClientClass = new NonOnClientClass();
    hostObjectSync.track(nonClientClass);

    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);

    const clientClass = clientObjectSync.findObjectOfType(NonOnClientClass)!;
    assert.equal(clientClass, null);

    nonClientClass.value = 55;
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);
  });

  it("should report changes to client", async () => {
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);
    const clientRoot = clientObjectSync.findObjectOfType(Root)!;

    assert.strictEqual(clientRoot.value, hostRoot.value);

    hostRoot.value = 100;
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);
    assert.strictEqual(clientRoot.value, hostRoot.value);
  });

  it("should not report untracked changes to client", async () => {
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);
    const clientRoot = clientObjectSync.findObjectOfType(Root)!;

    assert.strictEqual(clientRoot.value, hostRoot.value);

    hostRoot.untrackedValue = 100;
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);
    assert.notStrictEqual(clientRoot.untrackedValue, hostRoot.untrackedValue);
  });

  it("should execute methods on client", async () => {
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);

    const invokeArgument = 55;
    const expectedHostResult = invokeArgument + invokeArgument;

    const { clientResults, hostResult } = hostObjectSync.getInvokeProxy(hostRoot).invoke(invokeArgument);

    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);
    const clientInvokeResults = await clientResults;
    const clientResult = await clientInvokeResults.get(clientObjectSyncClientConnection)!;
    const hostResultValue = await hostResult;

    assert.strictEqual(hostResultValue, expectedHostResult);
    assert.strictEqual(clientResult, expectedHostResult);
  });

  it("should execute non promise methods on client", async () => {
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);

    const invokeArgument = 55;
    const expectedHostResult = invokeArgument + invokeArgument;

    const { clientResults, hostResult } = hostObjectSync.invoke(hostRoot, "invokeSync", invokeArgument);

    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);
    const clientInvokeResults = await clientResults;
    const clientResult = await clientInvokeResults.get(clientObjectSyncClientConnection)!;

    assert.strictEqual(hostResult, expectedHostResult);
    assert.strictEqual(clientResult, expectedHostResult);
  });

  it("should send anything to the host", async () => {
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);
    const clientRoot = clientObjectSync.findObjectOfType(Root)!;

    const oldHostValue = hostRoot.value;
    clientRoot.value = 77;

    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);
    assert.strictEqual(hostRoot.value, oldHostValue);
  });

  it("should sync serializable types", async () => {
    hostRoot.testClass = new SerializableClass(123);
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);

    const clientRoot = clientObjectSync.findObjectOfType(Root)!;
    assert.notStrictEqual(clientRoot.testClass, hostRoot.testClass);
    assert.strictEqual(clientRoot.testClass!.value, hostRoot.testClass!.value);
  });

  it("should sync a different type to the client", async () => {
    hostRoot.value = 42;
    hostRoot.syncAsClientRoot = true;
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);

    const clientRoot = clientObjectSync.findObjectOfType(ClientRoot)!;
    assert.notStrictEqual(clientRoot, hostRoot);
    assert.strictEqual(clientRoot.value, hostRoot.value);
  });

  it("it should send a different value than the original value to the client", async () => {
    hostRoot.value = 42;
    hostRoot.allowValueMutation = true;
    await exchangeMessagesAsync(hostObjectSync, clientObjectSync);

    const clientRoot = clientObjectSync.findObjectOfType(Root)!;
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
