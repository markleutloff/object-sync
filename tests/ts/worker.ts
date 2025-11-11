import { parentPort } from "worker_threads";
import { ClientConnection, Message, ObjectSync, syncMethod, syncObject, syncProperty } from "../../src/index.js";

@syncObject()
class Root {
  @syncProperty()
  accessor value: number = 0;

  @syncMethod({
    promiseHandlingType: "await",
  })
  invoke(returnValue: string) {
    return returnValue;
  }
}

const clientSync = new ObjectSync({ identity: "client", typeGenerators: [Root] });
const clientTokenFromHost = clientSync.registerClient({
  identity: "host",
});

parentPort!.on("message", async (message: { type: string; data: any }) => {
  if (message.type === "messages") {
    const messagesByClient = new Map<ClientConnection, Message[]>();
    messagesByClient.set(clientTokenFromHost, message.data as Message[]);
    const methodResponses = (await clientSync.applyMessagesAsync(messagesByClient)).get(clientTokenFromHost)!;
    const messages = clientSync.getMessages();

    const response = {
      methodResponses,
      messages: messages.get(clientTokenFromHost)!,
    };

    parentPort!.postMessage(response);
  } else {
    throw new Error(`Unknown message type: ${message.type}`);
  }
});
