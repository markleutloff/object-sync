// Type which has only T or any iterable of T
export type OneOrMany<T> = T | Iterable<T>;

export function isIterable<T>(input: OneOrMany<T>): input is Iterable<T> {
  return input && Symbol.iterator in Object(input) && typeof input !== "string";
}

// function which converts OneOrMany<T> to an iterable of T
export function toIterable<T>(input: OneOrMany<T>, preferSet = false): Iterable<T> {
  if (isIterable(input)) {
    return input as Iterable<T>;
  }
  return (preferSet ? new Set([input]) : [input]) as Iterable<T>;
}

export function forEachIterable<T>(input: OneOrMany<T>, callback: (item: T) => void): void {
  if (isIterable(input)) {
    for (const item of input) {
      callback(item);
    }
  } else {
    callback(input);
  }
}

export function mapIterable<T, U>(input: OneOrMany<T>, mapper: (item: T) => U): U[] {
  const result: U[] = [];
  if (isIterable(input)) {
    for (const item of input) {
      result.push(mapper(item));
    }
  } else {
    result.push(mapper(input));
  }
  return result;
}

export function filterIterable<T>(input: OneOrMany<T>, predicate: (item: T) => boolean): T[] {
  const result: T[] = [];
  if (isIterable(input)) {
    for (const item of input) {
      if (predicate(item)) {
        result.push(item);
      }
    }
  } else {
    if (predicate(input)) {
      result.push(input);
    }
  }

  return result;
}

export function findInIterable<T>(input: OneOrMany<T>, predicate: (item: T) => boolean): T | undefined {
  if (isIterable(input)) {
    for (const item of input) {
      if (predicate(item)) {
        return item;
      }
    }
    return undefined;
  } else {
    return predicate(input) ? input : undefined;
  }
}

export function hasInIterable<T>(input: OneOrMany<T>, expected: T): boolean {
  if (input instanceof Set) {
    return input.has(expected);
  } else if (input instanceof Map) {
    return input.has(expected);
  } else if (Array.isArray(input)) {
    return input.includes(expected);
  } else if (isIterable(input)) {
    for (const item of input) {
      if (item === expected) {
        return true;
      }
    }
    return false;
  } else {
    return input === expected;
  }
}

export type Constructor<T = any> = { new (...args: any[]): T };
export type AbstractConstructor<T = any> = abstract new (...args: any[]) => T;
export function isPrimitiveValue(value: any): boolean {
  return value === undefined || value === null || (typeof value !== "object" && typeof value !== "function");
}

export function isPromiseLike(value: any): value is Promise<any> {
  return value && typeof value.then === "function" && typeof value.catch === "function";
}
