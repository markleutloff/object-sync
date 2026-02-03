import { serializeValue, deserializeValue } from "../../src/index.js";
import { describe, it } from "node:test";
import assert from "assert";

describe("Simple Serialization", () => {
  it("should serialize and deserialize simple objects correctly", async () => {
    const testObject: Record<string, any> = {
      a: 1,
      b: "test",
      c: true,
      d: null,
      e: undefined,
      f: { nested: "value" },
      g: [1, 2, 3],
      h: new Map([
        ["key1", "value1"],
        ["key2", "value2"],
      ]),
      i: new Set([1, 2, 3]),
    };
    testObject.self = testObject;

    const serialized = serializeValue(testObject);
    const deserialized = deserializeValue(serialized)!;

    assert.strictEqual(deserialized.a, testObject.a);
    assert.strictEqual(deserialized.b, testObject.b);
    assert.strictEqual(deserialized.c, testObject.c);
    assert.strictEqual(deserialized.d, testObject.d);
    assert.strictEqual(deserialized.e, testObject.e);
    assert.deepStrictEqual(deserialized.f.nested, testObject.f.nested);
    assert.deepStrictEqual(deserialized.self, deserialized);
    assert.deepStrictEqual(deserialized.self.f.nested, testObject.f.nested);
    assert.deepStrictEqual(deserialized.g, testObject.g);
    assert.deepStrictEqual(Array.from(deserialized.h.entries()), Array.from(testObject.h.entries()));
    assert.deepStrictEqual(Array.from(deserialized.i.values()), Array.from(testObject.i.values()));
  });

  it("should serialize and deserialize primitives", async () => {
    const value = "hello";
    const serialized = serializeValue(value);
    const deserialized = deserializeValue(serialized)!;

    assert.strictEqual(deserialized, value);
  });
});
