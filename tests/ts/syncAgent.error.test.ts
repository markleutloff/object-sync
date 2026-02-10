import { describe, it, beforeEach } from "node:test";
import { ObjectSync, ClientToken, Message, syncObject, syncMethod } from "../../src/index.js";
import assert from "assert";

@syncObject()
class Alpha {
  @syncMethod()
  doSomething(a: string): string {
    throw new Error(a);
  }
}

class CustomError extends Error {
  public extra: string = "value";
  constructor(message: string) {
    super(message);
    this.name = "CustomError";
  }
}

class ManipulatedError extends Error {
  constructor(message: any) {
    super(message);
    this.name = "ManipulatedError";

    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop === "message") {
          return {
            manipulated: true,
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }
}

describe("Error Serializer", () => {
  let sourceSync: ObjectSync;
  let destSync: ObjectSync;
  let sourceSyncDestClientToken: ClientToken;
  let destSyncDestClientToken: ClientToken;

  const sendDataToDest = async (messages?: Message[]) => {
    messages ??= sourceSync.getMessages(sourceSyncDestClientToken);
    await destSync.applyMessagesAsync(messages, destSyncDestClientToken);
  };

  const sendDataToSource = async (messages?: Message[]) => {
    messages ??= destSync.getMessages(destSyncDestClientToken);
    await sourceSync.applyMessagesAsync(messages, sourceSyncDestClientToken);
  };

  beforeEach(() => {
    sourceSync = new ObjectSync({
      identity: "source",
    });
    sourceSyncDestClientToken = sourceSync.registerClient({ identity: "dest" });
    destSync = new ObjectSync({
      identity: "dest",
    });
    destSyncDestClientToken = destSync.registerClient({ identity: "source" });
  });

  it("should transfer Error class", async () => {
    const error = new Error("Test error");
    sourceSync.track(error, "main");

    await sendDataToDest();

    const destError = destSync.rootObjects.findOne(Error, "main")!;

    assert(Boolean(destError));
    assert.strictEqual(destError.message, error.message);
    assert.strictEqual(destError.stack, error.stack);
  });

  it("should transfer TypeError class", async () => {
    const error = new TypeError("Test type error");
    sourceSync.track(error, "main");

    await sendDataToDest();

    const destError = destSync.rootObjects.findOne(TypeError, "main")!;

    assert(Boolean(destError));
    assert.strictEqual(destError.message, error.message);
    assert.strictEqual(destError.stack, error.stack);
  });

  it("should transfer AggregateError class", async () => {
    const error = new AggregateError([new Error("Inner error")], "Test aggregate error");
    sourceSync.track(error, "main");

    await sendDataToDest();

    const destError = destSync.rootObjects.findOne(AggregateError, "main")!;

    assert(Boolean(destError));
    assert.strictEqual(destError.message, error.message);
    assert.strictEqual(destError.stack, error.stack);
    assert.strictEqual(destError.errors.length, 1);
    assert.strictEqual((destError.errors[0] as Error).message, "Inner error");
  });

  it("should not transfer custom data in the error", async () => {
    const error = new AggregateError(
      [
        {
          foo: "bar",
        },
      ],
      "Faulty aggregate error",
    );
    (error as any).extra = "some extra data";
    sourceSync.track(error, "main");

    await sendDataToDest();

    const destError = destSync.rootObjects.findOne(AggregateError, "main")!;

    assert(Boolean(destError));
    assert.strictEqual((destError as any).extra, undefined);
    assert.strictEqual(destError.message, error.message);
    assert.strictEqual(destError.stack, error.stack);
    assert.strictEqual(destError.errors.length, 0);
  });

  it("should transfer custom error types as normal error", async () => {
    const error = new CustomError("Test custom error");
    sourceSync.track(error, "main");

    await sendDataToDest();

    const destError = destSync.rootObjects.findOne(Error, "main")!;

    assert(Boolean(destError));
    assert.strictEqual((destError as any).extra, undefined);
    assert.strictEqual(destError.message, error.message);
    assert.strictEqual(destError.stack, error.stack);
  });

  it("should not transfer manipulated error data", async () => {
    const error = new ManipulatedError({ foo: "bar" });
    sourceSync.track(error, "main");
    await sendDataToDest();

    const destError = destSync.rootObjects.findOne(Error, "main")!;
    assert(Boolean(destError));
    assert.strictEqual(destError.message, "[object Object]");
  });

  it("should transfer the cause", async () => {
    const causeError = new Error("Cause error");
    const error = new Error("Test error", { cause: causeError });
    sourceSync.track(error, "main");
    await sendDataToDest();

    const destError = destSync.rootObjects.findOne(Error, "main")!;
    assert(Boolean(destError));
    assert.strictEqual(destError.message, error.message);
    assert.strictEqual(destError.stack, error.stack);
    assert(Boolean(destError.cause));
    assert.strictEqual((destError.cause as Error).message, causeError.message);
    assert.strictEqual((destError.cause as Error).stack, causeError.stack);
  });

  it("should transfer method invocation rejection results", async () => {
    const alpha = new Alpha();
    sourceSync.track(alpha, "main");

    let catchedError: Error = null!;
    sourceSync
      .getSyncAgent(alpha)!
      .invoke(sourceSyncDestClientToken, "doSomething", "test error")
      .catch((err: any) => {
        catchedError = err;
      });

    await sendDataToDest();
    await sendDataToSource();

    assert(Boolean(catchedError));
    assert((catchedError as any) instanceof Error);
    assert.strictEqual((catchedError as Error).message, "test error");
  });
});
