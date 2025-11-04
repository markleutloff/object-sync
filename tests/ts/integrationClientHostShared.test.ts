import { describe, it, beforeEach } from "node:test";
import assert from "assert";
import { ObjectSyncHost, ObjectSyncClient, ClientConnection, MethodCallResult, MethodCallResultByClient } from "../../src/index.js";
import { Alpha, assertThrowsAsync, Beta, Gamma, resolveOrTimeout } from "./shared.js";

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

  it("should sync objects and methods between host and client", async () => {
    // Host: get all creation messages for the client
    const creationMessages = host.getMessages().get(clientToken)!;
    // Client: applyAsync all creation messages
    await client.applyAsync(creationMessages as any);
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
    await client.applyAsync(changeMessages as any);
    assert.strictEqual(gammaClient.alpha.nonSpecial, "changed");
    // Host: execute a method
    gamma.alpha.what(42);
    const execMessages = host.getMessages().get(clientToken)!;

    await client.applyAsync(execMessages as any);
    assert.strictEqual((gammaClient.alpha as any)._lastWhat, 42);
  });

  it("should wait for the client to have executed the method call", async () => {
    // Host: get all creation messages for the client
    const creationMessages = host.getMessages().get(clientToken)!;
    // Client: applyAsync all creation messages
    await client.applyAsync(creationMessages as any);

    const expectedResultFromFunctionCall = 42;
    const results = gamma.alpha.callFunctionOnClients(expectedResultFromFunctionCall, 100)! as unknown as MethodCallResult<number>;

    const execMessages = host.getMessages().get(clientToken)!;

    const clientResult = await client.applyAsync(execMessages as any);

    host.applyClientMethodInvokeResults(clientToken, clientResult.methodExecuteResults);

    let result: MethodCallResultByClient<number>;
    try {
      result = await resolveOrTimeout(1000, results.resultsByClient);
    } catch (error) {
      assert.fail("Method execution on client timed out");
    }

    const resultFromClient = await result.get(clientToken);
    assert.strictEqual(resultFromClient, expectedResultFromFunctionCall);
  });

  it("should report when an object is untracked before its method can be invoked", async () => {
    // Host: get all creation messages for the client
    const creationMessages = host.getMessages().get(clientToken)!;
    // Client: applyAsync all creation messages
    await client.applyAsync(creationMessages as any);

    const results = gamma.alpha.callFunctionOnClients(42, 100) as unknown as MethodCallResult<number>;

    host.getMessages().get(clientToken)!;
    host.untrack(gamma);

    let result: MethodCallResultByClient<number>;
    try {
      result = await resolveOrTimeout(1000, results.resultsByClient);
    } catch (error) {
      assert.fail("Method execution on client timed out");
    }

    assertThrowsAsync(result.get(clientToken)!);
  });

  it("should report when an client is removed before its method can be invoked", async () => {
    // Host: get all creation messages for the client
    const creationMessages = host.getMessages().get(clientToken)!;
    // Client: applyAsync all creation messages
    await client.applyAsync(creationMessages as any);

    const results = gamma.alpha.callFunctionOnClients(42, 100) as unknown as MethodCallResult<number>;

    host.getMessages().get(clientToken)!;
    host.removeClient(clientToken);

    let result: MethodCallResultByClient<number>;
    try {
      result = await resolveOrTimeout(1000, results.resultsByClient);
    } catch (error) {
      assert.fail("Method execution on client timed out");
    }

    assert.equal(result.get(clientToken), undefined);
  });
});
