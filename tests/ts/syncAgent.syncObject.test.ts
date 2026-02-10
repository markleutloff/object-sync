import { describe, it, beforeEach } from "node:test";
import { ObjectSync, ClientToken, Message, syncObject, syncProperty, syncMethod, CreateObjectMessage } from "../../src/index.js";
import { assertObjectsEqual } from "./utils.js";
import assert from "assert";

@syncObject()
class Alpha {
  @syncProperty()
  accessor someReference: Beta | null = null;

  @syncMethod()
  doSomething(a: string): string {
    // Do nothing
    return a;
  }

  @syncMethod({
    promiseHandlingType: "await",
  })
  async doSomethingAsync(a: string): Promise<string> {
    // Do nothing
    return a;
  }

  @syncMethod()
  returnBeta(a: Beta, b: string): Beta {
    // Do nothing
    const result = new Beta();
    result.value = a.value + b;
    return result;
  }

  @syncProperty()
  accessor storedBeta: Beta | null = null;

  @syncMethod()
  returnAndStoreBeta(): Beta {
    if (!this.storedBeta) {
      this.storedBeta = new Beta();
      this.storedBeta.value = "stored";
    }
    return this.storedBeta;
  }
}

@syncObject()
class Beta {
  @syncProperty()
  accessor value: string = "default";
}

@syncObject({
  constructorArguments: ["value"],
})
class Gamma0 {
  constructor(value: string) {
    this.value = value;
  }
  @syncProperty()
  accessor value: string = "default";
}

@syncObject({
  constructorArguments() {
    return ["value"];
  },
  allowedConstructorParameterTypesFromSender: [[String]],
})
class Gamma1 extends Gamma0 {}

@syncObject({
  constructorArguments() {
    return {
      arguments: [this.value],
      propertiesToOmit: ["value"],
    };
  },
})
class Gamma2 extends Gamma0 {}

describe("SyncObject Serializer", () => {
  let sourceSync: ObjectSync;
  let destSync: ObjectSync;
  let sourceObject: Alpha;
  let sourceSyncDestClientToken: ClientToken;
  let destSyncDestClientToken: ClientToken;

  const sendDataToDest = async (messages?: Message[]) => {
    messages ??= sourceSync.getMessages(sourceSyncDestClientToken);
    await destSync.applyMessagesAsync(messages, destSyncDestClientToken);

    return messages;
  };

  const sendDataToSource = async (messages?: Message[]) => {
    messages ??= destSync.getMessages(destSyncDestClientToken);
    await sourceSync.applyMessagesAsync(messages, sourceSyncDestClientToken);

    return messages;
  };

  beforeEach(() => {
    sourceSync = new ObjectSync({
      identity: "source",
    });
    sourceSyncDestClientToken = sourceSync.registerClient({ identity: "dest" });
    destSync = new ObjectSync({
      identity: "dest",
    });
    destSyncDestClientToken = destSync.registerClient({ identity: "source" });

    sourceObject = new Alpha();
    sourceObject.someReference = new Beta();
    sourceSync.track(sourceObject, "main");
  });

  it("should transfer initial data", async () => {
    await sendDataToDest();

    const destObject = destSync.rootObjects.findOne(Alpha, "main")!;

    assert(Boolean(destObject));
    assertObjectsEqual(sourceObject, destObject);
  });

  it("should transfer changed data", async () => {
    await sendDataToDest();
    sourceObject.someReference!.value = "changed value";
    await sendDataToDest();

    const destObject = destSync.rootObjects.findOne(Alpha, "main")!;
    assert(Boolean(destObject));
    assertObjectsEqual(sourceObject, destObject);
  });

  it("should delete unused references", async () => {
    await sendDataToDest();
    sourceObject.someReference = null;

    await sendDataToDest();

    const destObject = destSync.rootObjects.findOne(Alpha, "main")!;
    assert(Boolean(destObject));
    assertObjectsEqual(sourceObject, destObject);

    assert(sourceSync.rootObjects.findOne(Beta) === undefined);
    assert(destSync.rootObjects.findOne(Beta) === undefined);
  });

  it("invoke should reuse references", async () => {
    await sendDataToDest();

    let clientResultPromise = sourceSync.getSyncAgent(sourceObject)!.invoke(sourceSyncDestClientToken, "returnAndStoreBeta");
    await sendDataToDest();
    await sendDataToSource();
    const clientResult0 = await clientResultPromise;

    clientResultPromise = sourceSync.getSyncAgent(sourceObject)!.invoke(sourceSyncDestClientToken, "returnAndStoreBeta");
    await sendDataToDest();
    const sourceMessages = await sendDataToSource();
    const sourceCreateMessage = sourceMessages.find((m) => m.type === "create")!;
    assert(!sourceCreateMessage, "No new create message should be sent");

    const clientResult1 = await clientResultPromise;
    assert(clientResult0 === clientResult1);
  });

  it("should invoke sync methods", async () => {
    await sendDataToDest();

    const input = "hello";
    const clientResultPromise = sourceSync.getSyncAgent(sourceObject)!.invoke(sourceSyncDestClientToken, "doSomething", input);

    await sendDataToDest();
    await sendDataToSource();
    const clientResult = await clientResultPromise;
    assert(clientResult === input);
  });

  it("should invoke async methods", async () => {
    await sendDataToDest();

    const input = "hello";
    const clientResultPromise = sourceSync.getSyncAgent(sourceObject)!.invoke(sourceSyncDestClientToken, "doSomethingAsync", input);

    await sendDataToDest();
    await sendDataToSource();
    const clientResult = await clientResultPromise;
    assert(clientResult === input);
  });

  it("invoke should support references", async () => {
    await sendDataToDest();

    const input = new Beta();
    input.value = "test";
    const clientResultPromise = sourceSync.getSyncAgent(sourceObject)!.invoke(sourceSyncDestClientToken, "returnBeta", input, " modified");

    await sendDataToDest();
    await sendDataToSource();
    const clientResult = await clientResultPromise;
    assert(clientResult.value === input.value + " modified");
  });

  it("should clean up stored references", async () => {
    await sendDataToDest();

    sourceSync.untrack(sourceObject);

    await sendDataToDest();

    assert(destSync.allObjects.all.length === 0);
  });

  it("should support custom constructor arguments by property name", async () => {
    const gamma = new Gamma0("custom value");
    sourceSync.track(gamma, "gamma");

    const messages = await sendDataToDest();
    const createMessage = messages.find((m) => m.type === "create" && m.objectId === "gamma") as CreateObjectMessage;
    assert(createMessage.data["[[constructor]]"] !== undefined);
    assert(createMessage.data["value"] === undefined);

    const destGamma = destSync.rootObjects.findOne(Gamma0, "gamma")!;
    assert(destGamma.value === "custom value");
  });

  it("should support custom constructor arguments by property names from function", async () => {
    const gamma = new Gamma1("custom value");
    sourceSync.track(gamma, "gamma");

    const messages = await sendDataToDest();
    const createMessage = messages.find((m) => m.type === "create" && m.objectId === "gamma") as CreateObjectMessage;
    assert(createMessage.data["[[constructor]]"] !== undefined);
    assert(createMessage.data["value"] === undefined);

    const destGamma = destSync.rootObjects.findOne(Gamma1, "gamma")!;
    assert(destGamma.value === "custom value");
  });

  it("should prevent wrong types for custom constructor arguments", async () => {
    const gamma = new Gamma1(1234 as any);
    sourceSync.track(gamma, "gamma");

    try {
      await sendDataToDest();
      assert.ok(false, "Expected error to be thrown when transmitting not allowed type");
    } catch {
      assert.ok(true);
    }
  });

  it("should support custom constructor arguments by values from function", async () => {
    const gamma = new Gamma2("custom value");
    sourceSync.track(gamma, "gamma");

    const messages = await sendDataToDest();
    const createMessage = messages.find((m) => m.type === "create" && m.objectId === "gamma") as CreateObjectMessage;
    assert(createMessage.data["[[constructor]]"] !== undefined);
    assert(createMessage.data["value"] === undefined);

    const destGamma = destSync.rootObjects.findOne(Gamma2, "gamma")!;
    assert(destGamma.value === "custom value");
  });
});
