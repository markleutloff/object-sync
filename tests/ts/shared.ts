import { MethodCallResult, ObjectSyncClient, syncMethod, syncObject, syncProperty } from "../../src/index.js";
import assert from "assert";

@syncObject({})
export class Beta {
  @syncProperty()
  accessor value: number | undefined = 0;
}

@syncObject<Alpha>({
  generator: {
    create(client, properties, objectId, typeId) {
      return new Alpha(client);
    },
    getType(client, properties, objectId, typeId) {
      return Alpha;
    },
  },
})
export class Alpha {
  constructor(public readonly _owner?: ObjectSyncClient) {}

  @syncProperty()
  accessor nonSpecial: string | undefined;

  @syncProperty()
  accessor beta: Beta | undefined;

  @syncProperty({ designations: "special" })
  accessor special: string | undefined;

  @syncMethod()
  what(number: number) {
    (this as any)._lastWhat = number;
  }

  @syncMethod({
    returnResultsByClient: true,
    clientMethod: "callFunction",
  })
  callFunctionOnClients(value: number, timeout: number): number {
    return 0;
  }

  @syncMethod()
  callFunction(value: number, timeout: number) {
    return new Promise<number>((resolve) => {
      setTimeout(() => {
        resolve(value);
      }, timeout);
    });
  }
}

@syncObject<Gamma>({
  generator: {
    create(client, properties, objectId, typeId) {
      const result = new Gamma(properties.alpha!);
      properties.deleteProperty("alpha");
      return result;
    },
    getType(client, properties, objectId, typeId) {
      return Gamma;
    },
  },
})
export class Gamma {
  constructor(alpha: Alpha) {
    this.alpha = alpha;
  }
  @syncProperty()
  accessor alpha: Alpha;
}

export async function resolveOrTimeout<T>(timeout: number, promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timeout"));
    }, timeout);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function assertThrowsAsync(promise: Promise<any>, errorMessage: string = "Expected error was not thrown") {
  try {
    await promise;
    assert.fail(errorMessage);
  } catch (error) {
    // Expected error was thrown
  }
}
