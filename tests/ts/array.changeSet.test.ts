import { createChangeSet, applyChangeSet } from "../../src/serialization/serializers/array/changeSet.js";
import { describe, it } from "node:test";
import assert from "assert";

function createChangeSetAndApply(before: any[], after: any[], numberOfChangeSetEntries: number) {
  const changeSet = createChangeSet(before, after);
  const result = applyChangeSet(before.slice(), changeSet);
  assert.deepStrictEqual(result, after);
  assert.equal(changeSet.length, numberOfChangeSetEntries, `Expected ${numberOfChangeSetEntries} change set entries, but got ${changeSet.length}`);
}

describe("Array ChangeSet", () => {
  it("Should change nothing when not needed", () => {
    createChangeSetAndApply(["a", "b", "c"], ["a", "b", "c"], 0);
  });
  it("Should fill the array", () => {
    createChangeSetAndApply([], ["a", "b", "c"], 1);
  });
  it("Should clear the array", () => {
    createChangeSetAndApply(["a", "b", "c"], [], 1);
  });
  it("should add an element at the end", () => {
    createChangeSetAndApply(["a", "b", "c"], ["a", "b", "c", "d"], 1);
  });
  it("should remove an element at the end", () => {
    createChangeSetAndApply(["a", "b", "c"], ["a", "b"], 1);
  });
  it("should add an element at the start", () => {
    createChangeSetAndApply(["a", "b", "c"], ["x", "a", "b", "c"], 1);
  });
  it("should remove an element at the start", () => {
    createChangeSetAndApply(["a", "b", "c"], ["b", "c"], 1);
  });
  it("should remove two elements at the start", () => {
    createChangeSetAndApply(["a", "b", "c"], ["c"], 1);
  });
  it("should add an element in the middle", () => {
    createChangeSetAndApply(["a", "b", "c"], ["a", "x", "b", "c"], 1);
  });
  it("should remove an element in the middle", () => {
    createChangeSetAndApply(["a", "b", "c"], ["a", "c"], 1);
  });
  it("should replace elements at the start and end", () => {
    createChangeSetAndApply(["a", "b", "c", "d"], ["x", "b", "c", "y"], 2);
  });
  it("should completely replace the array", () => {
    createChangeSetAndApply(["a", "b", "c"], ["x", "y", "z"], 1);
  });
  it("should do a complex change", () => {
    createChangeSetAndApply(["a", "b", "c", "d", "e", "f"], ["x", "a", "b", "y", "d", "z"], 3);
  });
});
