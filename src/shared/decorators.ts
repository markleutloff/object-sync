// declare symbol to contain a symbol and metadata
declare global {
  interface SymbolConstructor {
    metadata: symbol;
  }
}
// shim Symbol.metadata
Symbol.metadata ??= Symbol("metadata");

export {}; // to convert file into a module
