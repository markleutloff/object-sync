import { getMetaInfo } from "../../../shared/index.js";
import { SyncArrayMetaInfo } from "./metaInfo.js";
import { SpliceInstructionEx } from "./changeSet.js";

const realInstanceSymbol = Symbol("realInstanceSymbol");
const ignoreSyncSpliceCounterByInstance = new Map<SyncableArray, number>();

export class SyncableArray<T = any> extends Array<T> {
  constructor(...initialData: T[]) {
    super(...initialData);

    const that = this;
    const proxy = new Proxy<SyncableArray<T>>(this, {
      get(target, prop, receiver) {
        if (prop === realInstanceSymbol) {
          return that;
        }

        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver) {
        const isIndexer = (typeof prop === "string" || typeof prop === "number") && !isNaN(Number(prop));
        if (isIndexer) return that.setAtIndex.call(receiver, Number(prop), value);

        if (prop === "length") {
          target.setLength.call(receiver, value);
          return true;
        }

        return Reflect.set(target, prop, value, receiver);
      },
    });
    return proxy;
  }

  setLength(value: number) {
    if (value >= 0 && !isIgnoringSpliceGathering(this)) {
      const oldLength = this.length;
      if (value < oldLength) {
        const spliceInstruction: SpliceInstructionEx = {
          start: value,
          deletedItems: this.slice(value, oldLength),
          items: [],
        };
        this.onSplice(spliceInstruction);
      } else if (value > oldLength) {
        const spliceInstruction: SpliceInstructionEx = {
          start: oldLength,
          deletedItems: [],
          items: new Array(value - oldLength).fill(undefined),
        };
        this.onSplice(spliceInstruction);
      }
    }
    withIgnoredSyncSplice(this, () => {
      super.length = value;
    });
  }

  setAtIndex(index: number, value: T) {
    if (index >= 0 && !isIgnoringSpliceGathering(this)) {
      const spliceInstruction: SpliceInstructionEx = {
        start: index,
        deletedItems: this.slice(index, index + 1),
        items: [value],
      };
      this.onSplice(spliceInstruction);
    }
    withIgnoredSyncSplice(this, () => {
      super[index] = value;
    });
    return true;
  }

  splice(start: number, deleteCount?: number, ...items: T[]): T[] {
    const actualStart = typeof start === "number" ? start : 0;
    const actualDeleteCount = typeof deleteCount === "number" ? deleteCount : this.length - actualStart;

    const deletedItems = withIgnoredSyncSplice(this, () => {
      return super.splice(actualStart, actualDeleteCount, ...items);
    });

    if (!isIgnoringSpliceGathering(this)) {
      const spliceInstruction: SpliceInstructionEx = {
        start: actualStart,
        deletedItems,
        items,
      };
      this.onSplice(spliceInstruction);
    }

    return deletedItems;
  }

  push(...items: T[]): number {
    if (!isIgnoringSpliceGathering(this)) {
      const start = this.length;
      const spliceInstruction: SpliceInstructionEx = {
        start,
        deletedItems: [],
        items,
      };
      this.onSplice(spliceInstruction);
    }
    return withIgnoredSyncSplice(this, () => {
      return super.push(...items);
    });
  }

  pop(): T | undefined {
    if (this.length === 0) return undefined;
    if (!isIgnoringSpliceGathering(this)) {
      const start = this.length - 1;
      const spliceInstruction: SpliceInstructionEx = {
        start,
        deletedItems: this.slice(start, start + 1),
        items: [],
      };
      this.onSplice(spliceInstruction);
    }
    return withIgnoredSyncSplice(this, () => {
      return super.pop();
    });
  }

  shift(): T | undefined {
    if (this.length === 0) return undefined;
    if (!isIgnoringSpliceGathering(this)) {
      const spliceInstruction: SpliceInstructionEx = {
        start: 0,
        deletedItems: this.slice(0, 1),
        items: [],
      };
      this.onSplice(spliceInstruction);
    }
    return withIgnoredSyncSplice(this, () => {
      return super.shift();
    });
  }

  unshift(...items: T[]): number {
    if (!isIgnoringSpliceGathering(this)) {
      const spliceInstruction: SpliceInstructionEx = {
        start: 0,
        deletedItems: [],
        items,
      };
      this.onSplice(spliceInstruction);
    }
    return withIgnoredSyncSplice(this, () => {
      return super.unshift(...items);
    });
  }

  reverse() {
    const result = withIgnoredSyncSplice(this, () => {
      return super.reverse();
    });
    if (!isIgnoringSpliceGathering(this)) {
      const spliceInstruction: SpliceInstructionEx = {
        start: 0,
        deletedItems: this.slice(0, this.length),
        items: [...this],
      };
      this.onSplice(spliceInstruction);
    }
    return result;
  }

  sort(compareFn?: ((a: T, b: T) => number) | undefined) {
    const result = withIgnoredSyncSplice(this, () => {
      return super.sort(compareFn);
    });

    if (!isIgnoringSpliceGathering(this)) {
      const spliceInstruction: SpliceInstructionEx = {
        start: 0,
        deletedItems: this.slice(0, this.length),
        items: [...this],
      };
      this.onSplice(spliceInstruction);
    }
    return result;
  }

  fill(value: T, start?: number, end?: number) {
    const actualStart = start !== undefined ? start : 0;
    const actualEnd = end !== undefined ? end : this.length;
    const result = withIgnoredSyncSplice(this, () => {
      return super.fill(value, start, end);
    });
    var itemsFromData = this.slice(actualStart, actualEnd);
    if (!isIgnoringSpliceGathering(this)) {
      const spliceInstruction: SpliceInstructionEx = {
        start: actualStart,
        deletedItems: this.slice(actualStart, actualEnd),
        items: itemsFromData,
      };
      this.onSplice(spliceInstruction);
    }
    return result;
  }

  copyWithin(target: number, start: number, end?: number) {
    const actualEnd = end !== undefined ? end : this.length;
    const result = withIgnoredSyncSplice(this, () => {
      return super.copyWithin(target, start, end);
    });
    var itemsFromData = this.slice(target, target + (actualEnd - start));
    if (!isIgnoringSpliceGathering(this)) {
      const spliceInstruction: SpliceInstructionEx = {
        start: target,
        deletedItems: this.slice(target, target + (actualEnd - start)),
        items: itemsFromData,
      };
      this.onSplice(spliceInstruction);
    }
    return result;
  }

  protected onSplice(spliceInstruction: SpliceInstructionEx<T>) {
    getMetaInfo(this, SyncArrayMetaInfo)?.reportSplice(this, spliceInstruction);
  }
}

function withIgnoredSyncSplice(instance: SyncableArray, action: () => any): any {
  const realInstance = ((instance as any)[realInstanceSymbol] as SyncableArray) ?? instance;
  const cnt = ignoreSyncSpliceCounterByInstance.get(realInstance) ?? 0;
  ignoreSyncSpliceCounterByInstance.set(realInstance, cnt + 1);
  try {
    return action();
  } finally {
    const cnt = ignoreSyncSpliceCounterByInstance.get(realInstance) ?? 1;
    if (cnt <= 1) {
      ignoreSyncSpliceCounterByInstance.delete(realInstance);
    } else {
      ignoreSyncSpliceCounterByInstance.set(realInstance, cnt - 1);
    }
  }
}

function isIgnoringSpliceGathering(instance: SyncableArray): boolean {
  const realInstance = ((instance as any)[realInstanceSymbol] as SyncableArray) ?? instance;
  const cnt = ignoreSyncSpliceCounterByInstance.get(realInstance) ?? 0;
  return cnt > 0;
}
