import { syncMethod, syncObject, syncProperty, ClientToken, ObjectSync, nothing, MakeSimpleTypeSerializer, ObjectSyncSettings, allSyncObjectTypes } from "../../src/index.js";
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
  let clientObjectSyncClientConnection: ClientToken;
  let hostObjectSyncClientConnection: ClientToken;

  let hostRoot: Root;

  beforeEach(() => {
    const SerializableClassSerializer = MakeSimpleTypeSerializer<SerializableClass, number>({
      typeId: "SerializableClass",
      type: SerializableClass,
      serialize: (obj: SerializableClass) => obj.value,
      deserialize: (data: any) => new SerializableClass(data),
    });
    const hostSettings: ObjectSyncSettings = {
      identity: "host",
      serializers: [SerializableClassSerializer, ...allSyncObjectTypes],
    };

    const clientSettings: ObjectSyncSettings = {
      identity: "client",
      serializers: [SerializableClassSerializer, Root, ClientRoot, ClassWithSubClass, SubTrackable],
    };

    hostObjectSync = new ObjectSync(hostSettings);
    clientObjectSync = new ObjectSync(clientSettings);

    clientObjectSyncClientConnection = hostObjectSync.registerClient({ identity: "client" });
    hostObjectSyncClientConnection = clientObjectSync.registerClient({ identity: "host" });

    hostRoot = new Root();
    hostObjectSync.track(hostRoot);
  });

  const exchangeMessagesAsync = async () => {
    const messagesFromHost = hostObjectSync.getMessages(clientObjectSyncClientConnection);
    await clientObjectSync.applyMessagesAsync(messagesFromHost, hostObjectSyncClientConnection);

    const messagesFromClient = clientObjectSync.getMessages(hostObjectSyncClientConnection);
    await hostObjectSync.applyMessagesAsync(messagesFromClient, clientObjectSyncClientConnection);
  };

  it("should report creation to client", async () => {
    hostRoot.value = 42;
    await exchangeMessagesAsync();

    const clientRoot = clientObjectSync.findOne(Root)!;
    assert.notStrictEqual(clientRoot, hostRoot);
    assert.strictEqual(clientRoot.value, hostRoot.value);
  });

  it("should report deletion to client", async () => {
    await exchangeMessagesAsync();
    const clientRoot = clientObjectSync.findOne(Root)!;

    hostObjectSync.untrack(hostRoot);
    await exchangeMessagesAsync();

    const clientRoot2 = clientObjectSync.findOne(Root);
    assert.notStrictEqual(clientRoot, clientRoot2);
    assert.strictEqual(clientRoot2, undefined);
  });

  it("should handle native array", async () => {
    hostRoot.array = [new SubTrackable(), new SubTrackable()];
    await exchangeMessagesAsync();
    const clientRoot = clientObjectSync.findOne(Root)!;

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

    const clientClassWithSubClass = clientObjectSync.findOne(ClassWithSubClass)!;
    assert.notStrictEqual(clientClassWithSubClass, classWithSubClass);

    const clientSubClass = clientClassWithSubClass.value;
    assert.equal(!!clientSubClass, true);
  });

  it("should ignore changes and method calls when class will not be created on client", async () => {
    const nonClientClass = new NonOnClientClass();
    hostObjectSync.track(nonClientClass);

    await exchangeMessagesAsync();

    const clientClass = clientObjectSync.findOne(NonOnClientClass)!;
    assert.equal(clientClass, undefined);

    nonClientClass.value = 55;
    await exchangeMessagesAsync();
  });

  it("should report changes to client", async () => {
    await exchangeMessagesAsync();
    const clientRoot = clientObjectSync.findOne(Root)!;

    assert.strictEqual(clientRoot.value, hostRoot.value);

    hostRoot.value = 100;
    await exchangeMessagesAsync();

    assert.strictEqual(clientRoot.value, hostRoot.value);
  });

  it("should not report untracked changes to client", async () => {
    await exchangeMessagesAsync();
    const clientRoot = clientObjectSync.findOne(Root)!;

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
    const clientResultPromise = hostObjectSync.getDispatcher(hostRoot)!.invoke(clientObjectSyncClientConnection, "invoke", invokeArgument);

    await exchangeMessagesAsync();
    const clientResult = await clientResultPromise;

    assert.strictEqual(hostResult, expectedHostResult);
    assert.strictEqual(clientResult, expectedHostResult);
  });

  it("should not track value from client", async () => {
    await exchangeMessagesAsync();
    const clientRoot = clientObjectSync.findOne(Root)!;

    const oldHostValue = hostRoot.value;
    clientRoot.value = 77;

    await exchangeMessagesAsync();
    assert.strictEqual(hostRoot.value, oldHostValue);
  });

  it("should sync serializable types", async () => {
    hostRoot.testClass = new SerializableClass(123);
    await exchangeMessagesAsync();

    const clientRoot = clientObjectSync.findOne(Root)!;
    assert.notStrictEqual(clientRoot.testClass, hostRoot.testClass);
    assert.strictEqual(clientRoot.testClass!.value, hostRoot.testClass!.value);
  });

  it("should sync a different type to the client", async () => {
    hostRoot.value = 42;
    hostRoot.syncAsClientRoot = true;
    await exchangeMessagesAsync();

    const clientRoot = clientObjectSync.findOne(ClientRoot)!;
    assert.notStrictEqual(clientRoot, hostRoot);
    assert.strictEqual(clientRoot.value, hostRoot.value);
  });

  it("it should send a different value than the original value to the client", async () => {
    hostRoot.value = 42;
    hostRoot.allowValueMutation = true;
    await exchangeMessagesAsync();

    const clientRoot = clientObjectSync.findOne(Root)!;
    assert.notStrictEqual(clientRoot.value, hostRoot.value);
  });
});
