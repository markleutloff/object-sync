import { describe, it, beforeEach } from "node:test";
import assert from "assert";
import { ObjectSyncClient, syncObject } from "../../src/index.js";
import { Alpha, assertThrowsAsync, Beta, Gamma } from "./shared.js";

@syncObject<Specified>({
  designations: "special",
})
export class Specified {
  constructor() {}
}

describe("ObjectSyncClient integration", () => {
  let client: ObjectSyncClient;
  let alpha: Alpha;
  let beta: Beta;
  let gamma: Gamma;

  beforeEach(() => {
    client = new ObjectSyncClient({
      designation: "client",
    });
    beta = new Beta();
    alpha = new Alpha(client);
    gamma = new Gamma(alpha);
  });

  it("should track and find objects by constructor", () => {
    // Simulate creation messages
    const messages = [
      { type: "create", objectId: 1, typeId: "Alpha", properties: {} },
      { type: "create", objectId: 2, typeId: "Beta", properties: {} },
    ];
    client.applyAsync(messages as any);
    const foundAlpha = client.findObjectOfType(Alpha);
    const foundBeta = client.findObjectOfType(Beta);
    assert(foundAlpha);
    assert(foundBeta);
  });

  it("should ignore properties not designated for the client", async () => {
    // Simulate creation messages
    const messages = [
      {
        type: "create",
        objectId: 1,
        typeId: "Alpha",
        properties: {
          special: { value: "should be ignored" },
          nonSpecial: { value: "should be set" },
        },
      },
    ];
    await client.applyAsync(messages as any);
    const foundAlpha = client.findObjectOfType(Alpha)!;
    assert(foundAlpha);
    assert.notEqual(foundAlpha.special, "should be ignored");
    assert.equal(foundAlpha.nonSpecial, "should be set");
  });

  it("should resolve property values with objectId references", async () => {
    // Simulate creation of Beta, then Alpha with beta property referencing Beta
    const messages = [
      { type: "create", objectId: 2, typeId: "Beta", properties: {} },
      { type: "create", objectId: 1, typeId: "Alpha", properties: { beta: { objectId: 2 } } },
    ];
    await client.applyAsync(messages as any);
    const foundAlpha = client.findObjectOfType(Alpha);
    assert(foundAlpha);
    assert(foundAlpha.beta instanceof Beta);
  });

  it("should execute methods on tracked objects", async () => {
    const messages = [
      { type: "create", objectId: 1, typeId: "Alpha", properties: {} },
      { type: "execute", objectId: 1, method: "what", parameters: [{ value: 42 }] },
    ];
    await client.applyAsync(messages as any);
    const foundAlpha = client.findObjectOfType(Alpha);
    assert(foundAlpha);
    assert.strictEqual((foundAlpha as any)._lastWhat, 42);
  });

  it("should throw if objectId reference is missing", async () => {
    const messages = [{ type: "create", objectId: 1, typeId: "Alpha", properties: { beta: { objectId: 999 } } }];

    await assertThrowsAsync(client.applyAsync(messages as any));
  });

  it("it should not create objects not designated for this client", async () => {
    const messages = [{ type: "create", objectId: 1, typeId: "Specified", properties: {} }];

    await assertThrowsAsync(client.applyAsync(messages as any));
  });
});

