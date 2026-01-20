import { Worker } from "node:worker_threads";
import { ClientConnection, getTrackerObjectInfo, Message, MethodExecuteResult, ObjectSync, syncMethod, syncObject, syncProperty } from "../../src";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "assert";

type ClientWorker = {
  clientToken: ClientConnection;
  requestAsync<T>(type: string, data: any): Promise<T>;
  terminate(): void;
};

type DataFromClient = {
  methodResponses: MethodExecuteResult[];
  messages: Message[];
};

@syncObject()
class Root {
  @syncProperty()
  accessor value: number = 0;

  @syncMethod({
    promiseHandlingType: "await",
    beforeExecuteOnClient({ instance, key, args, destinationClientConnection }) {
      args[0] = args[0] + destinationClientConnection.identity;
      return true;
    },
  })
  invoke(returnValue: string) {
    return returnValue;
  }
}

function createWorker(hostSync: ObjectSync, id: number): ClientWorker {
  // create worker by loading worker.js and passing in hostSync
  const workerPath = new URL("./worker.js", import.meta.url);
  const worker = new Worker(workerPath);

  const clientToken = hostSync.registerClient({
    identity: "client" + id,
  });

  return {
    get clientToken() {
      return clientToken;
    },
    terminate() {
      worker.terminate();
    },
    requestAsync<T>(type: string, data: any): Promise<T> {
      return new Promise((resolve) => {
        const handleMessage = (response: T) => {
          resolve(response);
        };
        worker.once("message", handleMessage);
        worker.postMessage({
          type,
          data,
        });
      });
    },
  };
}

async function exchangeMessagesAsync(hostSync: ObjectSync, clients: ClientWorker[]): Promise<void> {
  const messagesFromClients = new Map<ClientConnection, Message[]>();
  await hostSync.exchangeMessagesAsync(async (clientToken, messages) => {
    const client = clients.find((c) => c.clientToken === clientToken)!;
    const result = await client.requestAsync<DataFromClient>("messages", messages);

    messagesFromClients.set(clientToken, result.messages);
    return result.methodResponses;
  });

  await hostSync.applyMessagesAsync(messagesFromClients);
}

describe("ObjectSync with worker threads", () => {
  let hostObjectSync: ObjectSync;

  let hostRoot: Root;

  let workers: ClientWorker[] = [];

  beforeEach(() => {
    const defaultSettings = {
      typeSerializers: [],
    };
    const hostSettings = {
      identity: "host",
      typeGenerators: [Root],
      ...defaultSettings,
    };

    hostObjectSync = new ObjectSync(hostSettings);
    hostRoot = new Root();
    hostObjectSync.track(hostRoot);

    for (let i = 0; i < 3; i++) {
      const clientWorker = createWorker(hostObjectSync, i);
      workers.push(clientWorker);
    }
  });

  afterEach(() => {
    workers.forEach((worker) => worker.terminate());
    workers = [];
  });

  it("should report creation to clients", async () => {
    const prefixToSend = "response from client: ";
    const results = hostObjectSync.invoke(hostRoot, "invoke", prefixToSend);
    await exchangeMessagesAsync(hostObjectSync, workers);

    const clientResults = await results.clientResults;

    for (const [clientConnection, clientResult] of clientResults) {
      const response = await clientResult;
      const expectedResult = prefixToSend + clientConnection.identity;
      assert.strictEqual(response, expectedResult);
    }
  });
});
