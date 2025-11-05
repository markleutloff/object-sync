import { describe, it, beforeEach } from "node:test";
import assert from "assert";
import { syncMethod, syncObject, syncProperty, ClientConnection, ObjectSync, MethodCallResult, getHostObjectInfo } from "../../src/index.js";

@syncObject({ typeId: "Beta" })
class Beta {
  constructor(value: number = 0) {
    this.value = value;
  }
  @syncProperty() accessor value: number;

  @syncMethod({
    clientMethod: "invokeInternal",
  })
  public invoke(value: number): number {
    return value + value;
  }

  @syncMethod()
  private async invokeInternal(value: number): Promise<number> {
    return Promise.resolve(value);
  }
}

describe("ObjectSync client-host integration (objectSync)", () => {
  let objectSync0: ObjectSync;
  let objectSync1: ObjectSync;
  let hBeta: Beta;
  let clientToken0: ClientConnection;
  let clientToken1: ClientConnection;

  beforeEach(() => {
    objectSync0 = new ObjectSync({});
    objectSync1 = new ObjectSync({});
    hBeta = new Beta();

    clientToken0 = objectSync0.host.registerClient();
    clientToken1 = objectSync1.host.registerClient();

    objectSync0.host.track(hBeta);
  });

  it("should sync objects and methods between host and client", async () => {
    hBeta.value = 1;
    await exchangeMessagesAsync(objectSync0, objectSync1);

    const cBeta = objectSync1.client.findObjectOfType(Beta)!;
    assert.strictEqual(cBeta.value, hBeta.value);

    hBeta.value = 2;
    assert.notStrictEqual(cBeta.value, hBeta.value);
    await exchangeMessagesAsync(objectSync0, objectSync1);
    assert.strictEqual(cBeta.value, hBeta.value);

    cBeta.value = 3;
    assert.notStrictEqual(cBeta.value, hBeta.value);
    await exchangeMessagesAsync(objectSync0, objectSync1);
    assert.strictEqual(cBeta.value, hBeta.value);

    const hostResult = hBeta.invoke(4);
    const methodCallResult = getHostObjectInfo(hBeta)!.getInvokeResults("invoke")!;
    assert.strictEqual(hostResult, 4 + 4);
    await exchangeMessagesAsync(objectSync0, objectSync1);
    const resultsByClient = await methodCallResult;
    const resultFromClient = await resultsByClient.get(clientToken0);
    assert.strictEqual(resultFromClient, 4);
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


