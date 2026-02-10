import { getTrackableTypeInfo } from "../../src/syncAgents/agents/syncObject/decorators/syncObject.js";
import assert from "assert";

export function assertObjectsEqual(obj1: any, obj2: any) {
  if (obj1 === null || obj2 === null) {
    assert(obj1 === obj2, "both values should be null");
    return;
  }
  if (obj1 === undefined || obj2 === undefined) {
    assert(obj1 === obj2, "both values should be undefined");
    return;
  }
  if (obj1 instanceof Map) {
    assert(obj2 instanceof Map, "both values should be Maps");
    assert(obj1 !== obj2, "Map references should not be the same");
    assert(obj1.size === obj2.size, "Maps should have the same size");
    const keys1 = Array.from(obj1.keys());
    const values1 = Array.from(obj1.values());
    const keys2 = Array.from(obj2.keys());
    const values2 = Array.from(obj2.values());
    assertObjectsEqual(keys1, keys2);
    assertObjectsEqual(values1, values2);
    return;
  }
  if (obj2 instanceof Set) {
    assert(obj2 instanceof Set, "both values should be Sets");
    assert(obj1 !== obj2, "Set references should not be the same");
    assert(obj1.size === obj2.size, "Sets should have the same size");
    const values1 = Array.from(obj1.values());
    const values2 = Array.from(obj2.values());
    assertObjectsEqual(values1, values2);
    return;
  }
  if (Array.isArray(obj1)) {
    assert(Array.isArray(obj2), "both values should be arrays");
    assert(obj1 !== obj2, "array references should not be the same");
    assert(obj1.length === obj2.length, "arrays should have the same length");
    for (let i = 0; i < obj1.length; i++) {
      const obj1Item = obj1[i];
      const obj2Item = obj2[i];

      assertObjectsEqual(obj1Item, obj2Item);
    }
  } else if (typeof obj1 === "object") {
    assert(typeof obj2 === "object", "both values should be objects");
    assert(obj1 !== obj2, "object references should not be the same");

    const trackableTypeInfo = getTrackableTypeInfo(obj1.constructor);
    if (trackableTypeInfo) {
      for (const propertyName of trackableTypeInfo.trackedProperties.keys()) {
        const obj1Value = obj1[propertyName];
        const obj2Value = obj2[propertyName];
        assertObjectsEqual(obj1Value, obj2Value);
      }
    } else {
      for (const key of Object.keys(obj1)) {
        assertObjectsEqual(obj1[key], obj2[key]);
      }
    }
  } else {
    assert(obj1 === obj2, "primitive values are not equal");
  }
}
