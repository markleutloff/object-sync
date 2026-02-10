type SpanAndIndexMap = {
  span: Span;
  indexMap: Map<any, number[]>;
};

type PreprocessedSpanInfo =
  | {
      isIdentical: false;
      spanAndIndexMap0: SpanAndIndexMap;
      spanAndIndexMap1: SpanAndIndexMap;
    }
  | {
      isIdentical: true;
    };

export class Span<T = any> {
  private readonly _data: T[];

  public end: number;
  public start: number;

  constructor(dataOrSpan: T[] | Span<T>, start: number = 0, length?: number) {
    if (dataOrSpan instanceof Span) {
      this._data = dataOrSpan._data;
      this.start = dataOrSpan.start + start;
      this.end = length !== undefined ? this.start + length - 1 : dataOrSpan.end;
    } else {
      this._data = dataOrSpan;
      this.start = start;
      this.end = (length !== undefined ? this.start + length : dataOrSpan.length) - 1;
    }
    if (this.length > this._data.length) {
      this.end = this._data.length - 1;
    }
  }

  get length() {
    return this.end - this.start + 1;
  }

  get(index: number): T {
    return this._data[this.start + index];
  }

  get data(): T[] {
    return this._data.slice(this.start, this.end + 1);
  }

  subSpan(start: number, length: number): Span<T> {
    return new Span<T>(this._data, this.start + start, Math.min(length, this.length - start));
  }

  dataFromRange(start: number, length: number): T[] {
    return this._data.slice(this.start + start, this.start + start + length);
  }
}

export type SpliceInstruction<T = any> = {
  start: number;
  deleteCount: number;
  items: T[];
};

export type SpliceInstructionEx<T = any> = {
  start: number;
  deletedItems: T[];
  items: T[];
};

export function createChangeSet(before: any[] | Span, after: any[] | Span, startIndex: number = 0): SpliceInstruction[] {
  let beforeSpan = new Span(before);
  let afterSpan = new Span(after);

  let start = startIndex;

  if (beforeSpan.length === 0) return [{ start, deleteCount: 0, items: afterSpan.data }];
  if (afterSpan.length === 0) return [{ start, deleteCount: beforeSpan.length, items: [] }];

  const preprocessed = preprocessSpans(beforeSpan, afterSpan);
  if (preprocessed.isIdentical) return [];

  const results: SpliceInstruction[] = [];
  while (true) {
    const nextMatch = findMatchInIndexMaps(preprocessed.spanAndIndexMap0, preprocessed.spanAndIndexMap1);
    if (!nextMatch) break;

    const [indexInBefore, indexInAfter, skipCount] = nextMatch;

    // We found our match directly at the start of both spans
    // We simply advance both spans and look for the next match
    if (indexInBefore === 0 && indexInAfter === 0) {
      beforeSpan.start += skipCount;
      afterSpan.start += skipCount;
      start += skipCount;
      continue;
    }

    // We have some changes to record before the next match
    // Delete the non-matching items from the before span and insert the non-matching items from the after span
    results.push({ start, deleteCount: indexInBefore, items: afterSpan.dataFromRange(0, indexInAfter) });

    afterSpan.start += indexInAfter + skipCount - 1;
    beforeSpan.start += indexInBefore + skipCount - 1;
    start += indexInAfter + skipCount - 1;
  }

  // Delete the remaining before span and insert the remaining after span when needed
  if (beforeSpan.length > 0 || afterSpan.length > 0) results.push({ start, deleteCount: beforeSpan.length, items: afterSpan.data });

  return results;
}

export function applyChangeSet(array: any[], changeSet: SpliceInstruction[]) {
  for (const change of changeSet) {
    if (change.start > array.length && change.items.length > 0) {
      array[change.start] = undefined;
    }

    array.splice(change.start, change.deleteCount, ...change.items);
  }

  return array;
}

/**
 * Creates indexMaps and compares both spans for identity
 */
function preprocessSpans(span0: Span, span1: Span): PreprocessedSpanInfo {
  const sameLength = span0.length === span1.length;
  let isIdentical = sameLength;

  const indexMap0 = new Map<any, number[]>();
  const indexMap1 = new Map<any, number[]>();
  for (let inSpanIndex = 0; inSpanIndex < span0.length; inSpanIndex++) {
    const item0 = span0.get(inSpanIndex);
    storeSpanItemInIndexMap(span0, indexMap0, inSpanIndex, item0);

    // When we have the same length we can savely grab the item from the other span
    if (sameLength) {
      var item1 = span1.get(inSpanIndex);
      storeSpanItemInIndexMap(span1, indexMap1, inSpanIndex, item1);

      if (isIdentical && item0 !== item1) isIdentical = false;
    }
  }

  // When both spans are identical, we can skip further processing
  if (isIdentical) {
    return { isIdentical: true };
  }

  if (!sameLength) {
    for (let inSpanIndex = 0; inSpanIndex < span1.length; inSpanIndex++) {
      const item1 = span1.get(inSpanIndex);
      storeSpanItemInIndexMap(span1, indexMap1, inSpanIndex, item1);
    }
  }

  return {
    spanAndIndexMap0: {
      span: span0,
      indexMap: indexMap0,
    },
    spanAndIndexMap1: {
      span: span1,
      indexMap: indexMap1,
    },
    isIdentical,
  };
}

function storeSpanItemInIndexMap<T>(span: Span<T>, indexMap: Map<T, number[]>, inSpanIndex: number, item: T) {
  if (!indexMap.has(item)) indexMap.set(item, []);
  indexMap.get(item)!.push(inSpanIndex + span.start);
}

/**
 * Finds the indicies of an item that occurs in both index maps within the given spans.
 * @returns The indicies of the matching item in both spans and the number of matching items, or undefined if no match is found
 */
function findMatchInIndexMaps(spanAndIndexMap0: SpanAndIndexMap, spanAndIndexMap1: SpanAndIndexMap): [number, number, number] | undefined {
  const threshold0 = spanAndIndexMap0.span.start;
  const threshold1 = spanAndIndexMap1.span.start;
  for (let i = 0; i < spanAndIndexMap0.span.length; i++) {
    const item = spanAndIndexMap0.span.get(i);
    const indicesInMap0 = spanAndIndexMap0.indexMap.get(item);
    if (!indicesInMap0) continue;

    const indicesInMap1 = spanAndIndexMap1.indexMap.get(item);
    if (!indicesInMap1) continue;

    for (const indexInMap0 of indicesInMap0) {
      if (indexInMap0 < threshold0) continue;
      for (const indexInMap1 of indicesInMap1) {
        if (indexInMap1 < threshold1) continue;

        let countOfMatchingItems = 0;
        while (
          indexInMap0 + countOfMatchingItems <= spanAndIndexMap0.span.end &&
          indexInMap1 + countOfMatchingItems <= spanAndIndexMap1.span.end &&
          spanAndIndexMap0.span.get(indexInMap0 + countOfMatchingItems - threshold0) === spanAndIndexMap1.span.get(indexInMap1 + countOfMatchingItems - threshold1)
        ) {
          countOfMatchingItems++;
        }

        return [indexInMap0 - threshold0, indexInMap1 - threshold1, countOfMatchingItems];
      }
    }
  }
}
