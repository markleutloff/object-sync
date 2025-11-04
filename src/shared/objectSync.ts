import { ClientConnection, ObjectSyncHost } from "../host/host.js";
import { ObjectSyncClient } from "../client/client.js";
import { Message } from "./messages.js";
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

  async applyMessagesAsync(messagesByClient: Map<ClientConnection, Message[]>): Promise<void> {
    for (const [clientToken, messages] of messagesByClient) {
      const results = await this._client.applyAsync(messages);
      for (const obj of results.newTrackedObjects) {
        this._host.track(obj, {
          ignoreAlreadyTracked: true,
          knownClients: clientToken,
        });
      }

      this.host.applyClientMethodInvokeResults(clientToken, results.methodExecuteResults);
    }
  }
}
