import { describe, it, beforeEach } from "node:test";
import assert from "assert";
import * as bundled from "../../dist/index.js";

const { ObjectSyncClient, ObjectSyncHost, syncObject, syncProperty, syncMethod } = bundled;

describe("Bundled ESM package integration", () => {
  describe("Client", () => {
    @syncObject()
    class Beta {
      accessor delta: number | undefined;
    }

    @syncObject({
      generator: (client: any, properties: any, objectId: any, typeId: any) => {
        return { result: new Alpha(client) };
      },
    })
    class Alpha {
      constructor(public readonly _owner: any) {}
      accessor alpha: string | undefined;
      accessor beta: Beta | undefined;
      what(number: number) {
        (this as any)._lastWhat = number;
      }
    }

    let client: any;
    let alpha: any;
    let beta: any;

    beforeEach(() => {
      client = new ObjectSyncClient();
      alpha = new Alpha(client);
      beta = new Beta();
    });

    it("should create Alpha and Beta", () => {
      assert.ok(alpha instanceof Alpha);
      assert.ok(beta instanceof Beta);
    });
  });

  describe("Host", () => {
    @syncObject()
    class Alpha {
      constructor(a?: string, b?: Beta) {
        this.alpha = a;
        this.beta = b;
      }
      @syncProperty() accessor alpha: string | undefined;
      @syncProperty() accessor beta: Beta | undefined;
      @syncMethod() what(number: number) {
        (this as any)._lastWhat = number;
      }
    }

    @syncObject()
    class Beta {
      @syncProperty() accessor delta: number = 890;
    }

    let host: any;
    let alpha: any;
    let beta: any;

    beforeEach(() => {
      host = new ObjectSyncHost();
      alpha = new Alpha();
      beta = new Beta();
    });

    it("should create Alpha and Beta on host", () => {
      assert.ok(alpha instanceof Alpha);
      assert.ok(beta instanceof Beta);
    });
  });
});
