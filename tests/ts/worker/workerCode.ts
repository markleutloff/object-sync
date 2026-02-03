import { Message, ObjectSync } from "../../../src/index.js";
import { WorkerPort } from "./worker.js";
import { Root } from "./syncClasses.js";

/**
 * Normally this file will be the workerCode itself in any normal worker environment.
 * Here we export it as a function to imitate worker threads in node.js and web workers.
 */
export default function workerCode(parentPort: WorkerPort) {
  // Create our ObjectSync instance for the worker.
  const objectSyncFromWorker = new ObjectSync({ identity: "client", serializers: [Root] });

  // As we only communicate with the host we register the host client connection so that we can apply messages from the host.
  const clientTokenFromHost = objectSyncFromWorker.registerClient({
    identity: "host",
  });

  parentPort.on("message", async (messages: Message[]) => {
    // In this worker code we expect only messages from the host so we just use its token.
    await objectSyncFromWorker.applyMessagesAsync(messages, clientTokenFromHost);

    // Also as we only reply to the host we just request messages for it.
    const replyMessages = objectSyncFromWorker.getMessages(clientTokenFromHost);

    parentPort.postMessage(replyMessages);
  });
}
