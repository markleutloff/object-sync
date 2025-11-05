import { ClientConnection, ObjectSyncHost } from "../host/host.js";
import { ObjectSyncClient } from "../client/client.js";
import { Message, MethodExecuteResult } from "./messages.js";
import { TrackedObjectPool } from "./trackedObjectPool.js";

export type ObjectSyncSettings = {
  objectIdPrefix?: string;
  designation?: string;
};

export class ObjectSync {
  private readonly _host: ObjectSyncHost;
  private readonly _client: ObjectSyncClient;

  constructor(private _settings: ObjectSyncSettings) {
    const objectPool = new TrackedObjectPool();

    this._host = new ObjectSyncHost({
      objectPool,
      ...this._settings,
    });
    this._client = new ObjectSyncClient({
      objectPool,
    });
  }

  get host(): ObjectSyncHost {
    return this._host;
  }

  get client(): ObjectSyncClient {
    return this._client;
  }

  getMessages(): Map<ClientConnection, Message[]> {
    return this._host.getMessages();
  }

  applyClientMethodInvokeResults(resultsByClient: Map<ClientConnection, MethodExecuteResult[]>): void {
    for (const [clientToken, results] of resultsByClient) {
      this._host.applyClientMethodInvokeResults(clientToken, results);
    }
  }

  async applyMessagesAsync(messagesByClient: Map<ClientConnection, Message[]>): Promise<Map<ClientConnection, MethodExecuteResult[]>> {
    const resultsByClient = new Map<ClientConnection, MethodExecuteResult[]>();
    for (const [clientToken, messages] of messagesByClient) {
      const results = await this._client.applyAsync(messages);
      resultsByClient.set(clientToken, results.methodExecuteResults);
      for (const obj of results.newTrackedObjects) {
        this._host.track(obj, {
          ignoreAlreadyTracked: true,
          knownClients: clientToken,
        });
      }
    }
    return resultsByClient;
  }

  async exchangeMessagesAsync(
    sendToClientAsync: (client: ClientConnection, messages: Message[]) => Promise<MethodExecuteResult[]>,
    errorHandler?: (client: ClientConnection, error: any) => void
  ): Promise<void> {
    const messages = this.getMessages();
    const resultsByClient = new Map<ClientConnection, Promise<MethodExecuteResult[]>>();
    const allPromises: Promise<MethodExecuteResult[]>[] = [];

    for (const [clientToken, clientMessages] of messages) {
      const methodInvokeResults = sendToClientAsync(clientToken, clientMessages);
      allPromises.push(methodInvokeResults);
      resultsByClient.set(clientToken, methodInvokeResults);
    }

    await Promise.allSettled(allPromises);

    for (const [clientToken, resultsPromise] of resultsByClient) {
      try {
        const results = await resultsPromise;
        this._host.applyClientMethodInvokeResults(clientToken, results);
      } catch (error) {
        if (errorHandler) {
          errorHandler(clientToken, error);
        }
      }
    }
  }

  async exchangeMessagesBulkAsync(
    sendToClientsAsync: (messagesByClient: Map<ClientConnection, Message[]>) => Promise<Map<ClientConnection, MethodExecuteResult[]>>,
    errorHandler?: (client: ClientConnection, error: any) => void
  ): Promise<void> {
    const messages = this.getMessages();
    const resultsByClient = await sendToClientsAsync(messages);

    for (const [clientToken, resultsPromise] of resultsByClient) {
      try {
        const results = await resultsPromise;
        this._host.applyClientMethodInvokeResults(clientToken, results);
      } catch (error) {
        if (errorHandler) {
          errorHandler(clientToken, error);
        }
      }
    }
  }
}
