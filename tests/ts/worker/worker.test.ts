import { ClientToken, Message, ObjectSync } from "../../../src/index.js";
import { describe, it, beforeEach } from "node:test";
import { Worker } from "./worker.js";
import workerCode from "./workerCode.js";
import assert from "assert";
import { Root } from "./syncClasses.js";

type ClientWorker = {
  clientToken: ClientToken;
  requestAsync<TResponse>(data: any): Promise<TResponse>;
};

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

  it("should report invoke results from clients", async () => {
    const prefixToSend = "response from client: ";
    const clientResults = hostObjectSync.getDispatcher(hostRoot)!.invoke("invoke", prefixToSend);

    await exchangeMessagesAsync(hostObjectSync, workers);

    for (const [clientToken, clientResult] of clientResults) {
      const response = await clientResult;
      const expectedResult = prefixToSend + clientToken.identity;
      assert.strictEqual(response, expectedResult);
    }
  });
});

function createWorker(hostSync: ObjectSync, id: number): ClientWorker {
  const worker = new Worker(workerCode);
  worker.start();

  const clientToken = hostSync.registerClient({
    identity: "client" + id,
  });

  return {
    get clientToken() {
      return clientToken;
    },
    requestAsync<TResponse>(data: any): Promise<TResponse> {
      return new Promise((resolve) => {
        const handleMessage = (response: TResponse) => {
          resolve(response);
        };
        worker.once("message", handleMessage);
        worker.postMessage(data);
      });
    },
  };
}

async function exchangeMessagesAsync(hostSync: ObjectSync, clientWorkers: ClientWorker[]): Promise<void> {
  await hostSync.exchangeMessagesAsync({
    sendToClientAsync: async (clientToken, messages) => {
      const client = clientWorkers.find((c) => c.clientToken === clientToken)!;
      const replyMessages = await client.requestAsync<Message[]>(messages);
      return replyMessages;
    },
  });
}
