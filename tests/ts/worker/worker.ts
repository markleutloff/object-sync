import { EventEmitter, IEventEmitter } from "../../../src/index.js";

export type WorkerPort = IEventEmitter<WorkerEvents> & {
  postMessage(data: any): void;
};

export type WorkerFunction = (port: WorkerPort) => void;

type WorkerEvents = {
  message(data: any): void;
};

class WorkerPortImpl extends EventEmitter<WorkerEvents> implements WorkerPort {
  constructor(private readonly _worker: Worker) {
    super();
  }

  postMessage(message: any): void {
    this._worker.emit("message", message);
  }
}

/**
 * This worker imitates the node worker or a web worker.
 * It runs the provided worker function.
 */
export class Worker extends EventEmitter<WorkerEvents> {
  private readonly _port: WorkerPortImpl;

  constructor(private readonly _workerFunction: WorkerFunction) {
    super();
    this._port = new WorkerPortImpl(this);
  }

  start(): void {
    this._workerFunction(this._port);
  }

  postMessage(message: any): void {
    this._port.emit("message", message);
  }
}
