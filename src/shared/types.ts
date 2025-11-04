// Type which has only T or any iterable of T
export type OneOrMany<T> = T | Iterable<T>;

// function which converts OneOrMany<T> to an iterable of T
export function toIterable<T>(input: OneOrMany<T>, preferSet = false): Iterable<T> {
  if (Symbol.iterator in Object(input) && typeof input !== "string") {
    return input as Iterable<T>;
  }
  return (preferSet ? new Set([input]) : [input]) as Iterable<T>;
}

export function forEachIterable<T>(input: OneOrMany<T>, callback: (item: T) => void): void {
  for (const item of toIterable(input)) {
    callback(item);
  }
}

export function mapIterable<T, U>(input: OneOrMany<T>, mapper: (item: T) => U): U[] {
  const result: U[] = [];
  for (const item of toIterable(input)) {
    result.push(mapper(item));
  }

  return result;
}

export function filterIterable<T>(input: OneOrMany<T>, predicate: (item: T) => boolean): T[] {
  const result: T[] = [];
  for (const item of toIterable(input)) {
    if (predicate(item)) {
      result.push(item);
    }
  }

  return result;
}

export function findInIterable<T>(input: OneOrMany<T>, predicate: (item: T) => boolean): T | undefined {
  for (const item of toIterable(input)) {
    if (predicate(item)) {
      return item;
    }
  }
}

export function hasInIterable<T>(input: OneOrMany<T>, expected: T): boolean {
  if (input instanceof Set) {
    return input.has(expected);
  }
  for (const item of toIterable(input)) {
    if (item === expected) {
      return true;
    }
  }
  return false;
}

export type Constructor<T = any> = { new (...args: any[]): T };
