import { describe, it, beforeEach } from "node:test";
import assert from "assert";
import { ObjectSyncHost, ObjectSyncClient, ClientConnection } from "../../src/index.js";
import { Alpha, Beta, Gamma } from "./shared.js";

describe("ObjectSyncHost/ObjectSyncClient client-host integration (shared classes)", () => {
  let host: ObjectSyncHost;
  let client: ObjectSyncClient;
  let alpha: Alpha;
  let beta: Beta;
  let gamma: Gamma;
  let clientToken: ClientConnection;

  beforeEach(() => {
    host = new ObjectSyncHost();
    client = new ObjectSyncClient();
    beta = new Beta();
    alpha = new Alpha();
    alpha.nonSpecial = "initial";
    alpha.beta = beta;
    gamma = new Gamma(alpha);
    clientToken = host.registerClient();
    host.track(gamma);
  });

  it("should sync objects and methods between host and client", () => {
    // Host: get all creation messages for the client
    const creationMessages = host.getMessages().get(clientToken)!;
    // Client: apply all creation messages
    client.apply(creationMessages as any);
    // Find root object on client
    const gammaClient = client.findObjectOfType(Gamma);
    assert(gammaClient instanceof Gamma);
    assert(gammaClient.alpha instanceof Alpha);
    assert(gammaClient.alpha.beta instanceof Beta);
    // Check property values
    assert.strictEqual(gammaClient.alpha.nonSpecial, "initial");
    assert.strictEqual(gammaClient.alpha.beta.value, 0);
    // Host: change a property
    gamma.alpha.nonSpecial = "changed";
    const changeMessages = host.getMessages().get(clientToken)!;
    client.apply(changeMessages as any);
    assert.strictEqual(gammaClient.alpha.nonSpecial, "changed");
    // Host: execute a method
    gamma.alpha.what(42);
    const execMessages = host.getMessages().get(clientToken)!;

    client.apply(execMessages as any);
    assert.strictEqual((gammaClient.alpha as any)._lastWhat, 42);
  });
});
