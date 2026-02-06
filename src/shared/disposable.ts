export interface IDisposable {
  dispose(): void;
  [Symbol.dispose](): void;
}

export function createDisposable<TAdditionalData = undefined>(disposeFunction?: () => void, additionalData?: TAdditionalData): IDisposable & TAdditionalData {
  if (!disposeFunction) {
    return {
      dispose() {},
      [Symbol.dispose]() {},
      ...additionalData,
    } as IDisposable & TAdditionalData;
  }

  let isDisposed = false;
  return {
    dispose() {
      if (isDisposed) return;
      isDisposed = true;
      disposeFunction();
    },
    [Symbol.dispose]() {
      this.dispose();
    },
    ...additionalData,
  } as IDisposable & TAdditionalData;
}
