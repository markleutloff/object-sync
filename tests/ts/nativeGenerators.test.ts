import { ObjectSync, SyncableArray, ClientConnection, syncObject, syncProperty } from "../../src/index.js";
import { describe, it, beforeEach } from "node:test";
import assert from "assert";

@syncObject()
class Alpha {
  @syncProperty()
  accessor otherArray: any[] = [];

  @syncProperty()
  accessor someObject: object = {};

  @syncProperty()
  accessor someSet: Set<any> = new Set();

  @syncProperty()
  accessor someMap: Map<any, any> = new Map();
}

@syncObject()
class Beta {
  constructor(value: string = "default") {
    this.value = value;
  }

  @syncProperty()
  accessor value: string;
}

describe("ObjectSync Native TypeGenerators", () => {
  let alpha: Alpha;

  let hostObjectSync: ObjectSync;
  let clientObjectSync: ObjectSync;
  let clientObjectSyncClientConnection: ClientConnection;
  let hostObjectSyncClientConnection: ClientConnection;

  beforeEach(() => {
    const hostSettings = {
      identity: "host",
      typeGenerators: [Alpha, Beta],
    };

    const clientSettings = {
      identity: "client",
      typeGenerators: [Alpha, Beta],
    };

    hostObjectSync = new ObjectSync(hostSettings);
    clientObjectSync = new ObjectSync(clientSettings);

    clientObjectSyncClientConnection = hostObjectSync.registerClient({ identity: "client" });
    hostObjectSyncClientConnection = clientObjectSync.registerClient({ identity: "host" });

    alpha = new Alpha();
    hostObjectSync.track(alpha);
  });

  it("Array: should transfer any value", async () => {
    alpha.otherArray = [new Beta("first"), new Beta("second"), 1, true, "someString"];

    const clientMessages = hostObjectSync.getMessages(clientObjectSyncClientConnection);
    await clientObjectSync.applyAsync(clientMessages, hostObjectSyncClientConnection);

    const alphaClient = clientObjectSync.findObjectOfType(Alpha)!;
    for (let i = 0; i < alpha.otherArray.length; i++) {
      const originalItem = alpha.otherArray[i];
      const clientItem = alphaClient.otherArray[i];

      if (originalItem instanceof Beta) {
        assert.notStrictEqual(originalItem, clientItem);
        assert.strictEqual(clientItem instanceof Beta, true);
        assert.strictEqual(clientItem.value, originalItem.value);
      } else {
        assert.strictEqual(clientItem, originalItem);
      }
    }
  });

  it("Object: should transfer any value", async () => {
    alpha.someObject = { first: new Beta("first"), second: new Beta("second"), third: 1, fourth: true, fifth: "someString" };

    const clientMessages = hostObjectSync.getMessages(clientObjectSyncClientConnection);
    await clientObjectSync.applyAsync(clientMessages, hostObjectSyncClientConnection);

    const alphaClient = clientObjectSync.findObjectOfType(Alpha)!;
    const someObjectClient = alphaClient.someObject as any;
    for (const key of Object.keys(alpha.someObject as any)) {
      const originalItem = (alpha.someObject as any)[key];
      const clientItem = someObjectClient[key];
      if (originalItem instanceof Beta) {
        assert.notStrictEqual(originalItem, clientItem);
        assert.strictEqual(clientItem instanceof Beta, true);
        assert.strictEqual(clientItem.value, originalItem.value);
      } else {
        assert.strictEqual(clientItem, originalItem);
      }
    }
  });

  it("Map: should transfer any value", async () => {
    alpha.someMap.set("first", new Beta("first"));
    alpha.someMap.set("second", new Beta("second"));
    alpha.someMap.set("third", 1);
    alpha.someMap.set("fourth", true);
    alpha.someMap.set("fifth", "someString");

    const clientMessages = hostObjectSync.getMessages(clientObjectSyncClientConnection);
    await clientObjectSync.applyAsync(clientMessages, hostObjectSyncClientConnection);

    const alphaClient = clientObjectSync.findObjectOfType(Alpha)!;
    const someMapClient = alphaClient.someMap;
    for (const [key, originalItem] of alpha.someMap.entries()) {
      const clientItem = someMapClient.get(key);
      if (originalItem instanceof Beta) {
        assert.notStrictEqual(originalItem, clientItem);
        assert.strictEqual(clientItem instanceof Beta, true);
        assert.strictEqual(clientItem.value, originalItem.value);
      } else {
        assert.strictEqual(clientItem, originalItem);
      }
    }
  });

  it("Set: should transfer any value", async () => {
    alpha.someSet.add(new Beta("first"));
    alpha.someSet.add(new Beta("second"));
    alpha.someSet.add(1);
    alpha.someSet.add(true);
    alpha.someSet.add("someString");

    const clientMessages = hostObjectSync.getMessages(clientObjectSyncClientConnection);
    await clientObjectSync.applyAsync(clientMessages, hostObjectSyncClientConnection);

    const alphaClient = clientObjectSync.findObjectOfType(Alpha)!;
    const someSetClient = alphaClient.someSet;
    for (const originalItem of alpha.someSet.values()) {
      let found = false;
      for (const clientItem of someSetClient.values()) {
        if (originalItem instanceof Beta) {
          if (clientItem instanceof Beta && clientItem.value === originalItem.value) {
            found = true;
            break;
          }
        } else {
          if (clientItem === originalItem) {
            found = true;
            break;
          }
        }
      }
      assert.strictEqual(found, true, `Item ${originalItem} not found in client Set`);
    }
  });
});
