import { describe, it, beforeEach } from "node:test";
import assert from "assert";
import { syncObject, syncProperty, ClientConnection, ObjectSync, Message } from "../../src/index.js";

@syncObject({ typeId: "Beta" })
class Beta {
  constructor(value: number = 0) {
    this.value = value;
  }
  @syncProperty() accessor value: number;
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
    exchangeMessages();

    const cBeta = objectSync1.client.findObjectOfType(Beta)!;
    assert.strictEqual(cBeta.value, hBeta.value);

    hBeta.value = 2;
    assert.notStrictEqual(cBeta.value, hBeta.value);
    exchangeMessages();
    assert.strictEqual(cBeta.value, hBeta.value);

    cBeta.value = 3;
    assert.notStrictEqual(cBeta.value, hBeta.value);
    exchangeMessages();
    assert.strictEqual(cBeta.value, hBeta.value);

    function exchangeMessages() {
      const h2cMessages = objectSync0.getMessages();
      objectSync1.applyMessages(h2cMessages);
      const c2hMessages = objectSync1.getMessages();
      objectSync0.applyMessages(c2hMessages);
    }
  });
});
