import { describe, it, beforeEach } from "node:test";
import assert from "assert";
import { ObjectSyncClient, syncObject } from "../../src/index.js";
import { Alpha, Beta, Gamma } from "./shared.js";

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
    client.apply(messages as any);
    const foundAlpha = client.findObjectOfType(Alpha);
    const foundBeta = client.findObjectOfType(Beta);
    assert(foundAlpha);
    assert(foundBeta);
  });

  it("should ignore properties not designated for the client", () => {
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
    client.apply(messages as any);
    const foundAlpha = client.findObjectOfType(Alpha)!;
    assert(foundAlpha);
    assert.notEqual(foundAlpha.special, "should be ignored");
    assert.equal(foundAlpha.nonSpecial, "should be set");
  });

  it("should resolve property values with objectId references", () => {
    // Simulate creation of Beta, then Alpha with beta property referencing Beta
    const messages = [
      { type: "create", objectId: 2, typeId: "Beta", properties: {} },
      { type: "create", objectId: 1, typeId: "Alpha", properties: { beta: { objectId: 2 } } },
    ];
    client.apply(messages as any);
    const foundAlpha = client.findObjectOfType(Alpha);
    assert(foundAlpha);
    assert(foundAlpha.beta instanceof Beta);
  });

  it("should execute methods on tracked objects", () => {
    const messages = [
      { type: "create", objectId: 1, typeId: "Alpha", properties: {} },
      { type: "execute", objectId: 1, method: "what", parameters: [{ value: 42 }] },
    ];
    client.apply(messages as any);
    const foundAlpha = client.findObjectOfType(Alpha);
    assert(foundAlpha);
    assert.strictEqual((foundAlpha as any)._lastWhat, 42);
  });

  it("should throw if objectId reference is missing", () => {
    const messages = [{ type: "create", objectId: 1, typeId: "Alpha", properties: { beta: { objectId: 999 } } }];
    assert.throws(() => client.apply(messages as any));
  });

  it("it should not create objects not designated for this client", () => {
    const messages = [{ type: "create", objectId: 1, typeId: "Specified", properties: {} }];
    assert.throws(() => client.apply(messages as any));
  });
});
