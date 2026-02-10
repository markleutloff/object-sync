import { syncMethod, syncObject, syncProperty, ClientToken, ObjectSync, nothing, createSimpleSyncAgentProvider, ObjectSyncSettings, SyncableArray } from "../../src/index.js";
import { describe, it, beforeEach } from "node:test";
import assert from "assert";

@syncObject()
class SubTrackable {}

@syncObject({
  clientTypeId({ instance, typeId }) {
    return instance.syncAsClientRoot ? ClientRoot : typeId;
  },
})
class Root {
  syncAsClientRoot = false;
  allowValueMutation = false;

  @syncProperty({
    beforeSendToClient({ instance, key, value, destinationClientToken }) {
      if (destinationClientToken.identity === "host") {
        return nothing;
      }
      if (instance.allowValueMutation && key === "value") {
        return value + value;
      }
      return value;
    },
    canApply({ sourceClientToken }) {
      if (sourceClientToken.identity === "host") {
        return true;
      }
      return false;
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

  @syncProperty({
    allowedTypesFromSender: [SubTrackable, null],
  })
  accessor onlyAllowedType: SubTrackable | null = null;

  @syncProperty({
    allowedTypesFromSender: [SyncableArray],
  })
  accessor restrictedArray: number[] = new SyncableArray();
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
  clientTypeId: nothing,
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
  let clientObjectSyncClientToken: ClientToken;
  let hostObjectSyncClientToken: ClientToken;
  let hostRoot: Root;

  beforeEach(() => {
    createSimpleSyncAgentProvider<SerializableClass, number>({
      typeId: "SerializableClass",
      type: SerializableClass,
      serialize: (obj: SerializableClass) => obj.value,
      deserialize: (data: any) => new SerializableClass(data),
    });
    const hostSettings: ObjectSyncSettings = {
      identity: "host",
    };

    const clientSettings: ObjectSyncSettings = {
      identity: "client",
      types: [SerializableClass, Root, ClientRoot, ClassWithSubClass, SubTrackable, SyncableArray],
    };

    hostObjectSync = new ObjectSync(hostSettings);
    clientObjectSync = new ObjectSync(clientSettings);

    clientObjectSyncClientToken = hostObjectSync.registerClient({ identity: "client" });
    hostObjectSyncClientToken = clientObjectSync.registerClient({ identity: "host" });

    hostRoot = new Root();
    hostObjectSync.track(hostRoot);
  });

  const exchangeMessagesAsync = async () => {
    const messagesFromHost = hostObjectSync.getMessages(clientObjectSyncClientToken);
    await clientObjectSync.applyMessagesAsync(messagesFromHost, hostObjectSyncClientToken);

    const messagesFromClient = clientObjectSync.getMessages(hostObjectSyncClientToken);
    await hostObjectSync.applyMessagesAsync(messagesFromClient, clientObjectSyncClientToken);
  };

  it("should report creation to client", async () => {
    hostRoot.value = 42;
    await exchangeMessagesAsync();

    const clientRoot = clientObjectSync.rootObjects.findOne(Root)!;
    assert.notStrictEqual(clientRoot, hostRoot);
    assert.strictEqual(clientRoot.value, hostRoot.value);
  });

  it("should report deletion to client", async () => {
    await exchangeMessagesAsync();
    const clientRoot = clientObjectSync.rootObjects.findOne(Root)!;

    hostObjectSync.untrack(hostRoot);
    await exchangeMessagesAsync();

    const clientRoot2 = clientObjectSync.rootObjects.findOne(Root);
    assert.notStrictEqual(clientRoot, clientRoot2);
    assert.strictEqual(clientRoot2, undefined);
  });

  it("should handle native array", async () => {
    hostRoot.array = [new SubTrackable(), new SubTrackable()];
    await exchangeMessagesAsync();
    const clientRoot = clientObjectSync.rootObjects.findOne(Root)!;

    assert.strictEqual(clientRoot.array.length, 2);
    assert.strictEqual(clientRoot.array[0] instanceof SubTrackable, true);
    assert.strictEqual(clientRoot.array[0] instanceof SubTrackable, true);
    assert.notStrictEqual(clientRoot.array[0], hostRoot.array[0]);
    assert.notStrictEqual(clientRoot.array[1], hostRoot.array[1]);
  });

  it("should report sub tracked classes", async () => {
    const classWithSubClass = new ClassWithSubClass();
    hostObjectSync.track(classWithSubClass);

    await exchangeMessagesAsync();

    const clientClassWithSubClass = clientObjectSync.rootObjects.findOne(ClassWithSubClass)!;
    assert.notStrictEqual(clientClassWithSubClass, classWithSubClass);

    const clientSubClass = clientClassWithSubClass.value;
    assert.equal(!!clientSubClass, true);
  });

  it("should ignore changes and method calls when class will not be created on client", async () => {
    const nonClientClass = new NonOnClientClass();
    hostObjectSync.track(nonClientClass);

    await exchangeMessagesAsync();

    const clientClass = clientObjectSync.rootObjects.findOne(NonOnClientClass)!;
    assert.equal(clientClass, undefined);

    nonClientClass.value = 55;
    await exchangeMessagesAsync();
  });

  it("should report changes to client", async () => {
    await exchangeMessagesAsync();
    const clientRoot = clientObjectSync.rootObjects.findOne(Root)!;

    assert.strictEqual(clientRoot.value, hostRoot.value);

    hostRoot.value = 100;
    await exchangeMessagesAsync();

    assert.strictEqual(clientRoot.value, hostRoot.value);
  });

  it("should not report untracked changes to client", async () => {
    await exchangeMessagesAsync();
    const clientRoot = clientObjectSync.rootObjects.findOne(Root)!;

    assert.strictEqual(clientRoot.value, hostRoot.value);

    hostRoot.untrackedValue = 100;
    await exchangeMessagesAsync();
    assert.notStrictEqual(clientRoot.untrackedValue, hostRoot.untrackedValue);
  });

  it("should execute methods on client", async () => {
    await exchangeMessagesAsync();

    const invokeArgument = 55;
    const expectedHostResult = invokeArgument + invokeArgument;

    // Calling the host method
    const hostResult = await hostRoot.invoke(invokeArgument);
    // Enqueue the client method call
    const clientResultPromise = hostObjectSync.getSyncAgent(hostRoot)!.invoke(clientObjectSyncClientToken, "invoke", invokeArgument);

    await exchangeMessagesAsync();
    const clientResult = await clientResultPromise;

    assert.strictEqual(hostResult, expectedHostResult);
    assert.strictEqual(clientResult, expectedHostResult);
  });

  it("should not track value from client", async () => {
    await exchangeMessagesAsync();
    const clientRoot = clientObjectSync.rootObjects.findOne(Root)!;

    const oldHostValue = hostRoot.value;
    clientRoot.value = 77;

    await exchangeMessagesAsync();
    assert.strictEqual(hostRoot.value, oldHostValue);
  });

  it("should sync serializable types", async () => {
    hostRoot.testClass = new SerializableClass(123);
    await exchangeMessagesAsync();

    const clientRoot = clientObjectSync.rootObjects.findOne(Root)!;
    assert.notStrictEqual(clientRoot.testClass, hostRoot.testClass);
    assert.strictEqual(clientRoot.testClass!.value, hostRoot.testClass!.value);
  });

  it("should sync a different type to the client", async () => {
    hostRoot.value = 42;
    hostRoot.syncAsClientRoot = true;
    await exchangeMessagesAsync();

    const clientRoot = clientObjectSync.rootObjects.findOne(ClientRoot)!;
    assert.notStrictEqual(clientRoot, hostRoot);
    assert.strictEqual(clientRoot.value, hostRoot.value);
  });

  it("it should send a different value than the original value to the client", async () => {
    hostRoot.value = 42;
    hostRoot.allowValueMutation = true;
    await exchangeMessagesAsync();

    const clientRoot = clientObjectSync.rootObjects.findOne(Root)!;
    assert.notStrictEqual(clientRoot.value, hostRoot.value);
  });

  it("it should restrict the restricted array", async () => {
    const syncAgent = hostObjectSync.getSyncAgent(hostRoot.restrictedArray);
    assert(syncAgent, "Expected sync agent for restricted array to be found");

    syncAgent.allowedTypesFromSender = [Number];
    hostRoot.restrictedArray.push("bad item" as any);

    try {
      await exchangeMessagesAsync();
      assert.ok(false, "Expected error to be thrown when transmitting not allowed type");
    } catch {
      assert.ok(true);
    }
  });

  it("it should throw when an not allowed type is transmitted", async () => {
    hostRoot.value = 42;
    hostRoot.onlyAllowedType = [];
    try {
      await exchangeMessagesAsync();
      assert.ok(false, "Expected error to be thrown when transmitting not allowed type");
    } catch {
      assert.ok(true);
    }
  });
});
