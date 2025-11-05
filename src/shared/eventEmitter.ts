type EventFunction = (...args: any[]) => void;

export type EventMap = {
  [key: string]: EventFunction;
};

export type IEventEmitter<Events extends EventMap = EventMap> = {
  on<Event extends keyof Events>(event: Event, callback: Events[Event]): void;
  once<Event extends keyof Events>(event: Event, callback: Events[Event]): void;
  off<Event extends keyof Events>(event: Event, callback: Events[Event]): void;
  listenerCount<Event extends keyof Events>(event: Event, callback?: Events[Event] | undefined): number;
};

export class EventEmitter<Events extends EventMap = EventMap> implements IEventEmitter<Events> {
  readonly _events: {
    [key in keyof Events]?: EventFunction[];
  } = {};

  public on<Event extends keyof Events>(event: Event, callback: Events[Event]): void {
    if (!this._events[event]) this._events[event] = [callback];
    else this._events[event].push(callback);

    this.onEventListenerAdded(event, callback as Events[Event]);
  }

  public once<Event extends keyof Events>(event: Event, callback: Events[Event]): void {
    const onceCallback = ((...args: any[]) => {
      this.off(event, onceCallback);
      callback(...args);
    }) as Events[Event];

    this.on(event, onceCallback);
  }

  public off<Event extends keyof Events>(event: Event, callback: Events[Event]): void {
    if (!this._events[event]) return;

    this._events[event] = this._events[event].filter((cb) => cb !== callback);
    this.onEventListenerRemoved(event, callback);
  }

  public listenerCount<Event extends keyof Events>(event: Event, callback?: Events[Event]): number {
    if (!this._events[event]) return 0;

    if (!callback) return this._events[event].length;
    return this._events[event].filter((cb) => cb === callback).length;
  }

  public emit<Event extends keyof Events>(event: Event, ...args: any[]): void {
    if (!this._events[event]) return;

    for (const callback of this._events[event]) {
      callback(...args);
    }
  }

  // protected emit2<Event extends keyof Events>(event: Event, ...args: Parameters<Events[Event]>): void {
  //   if (!this._events[event as string]) return;
  //   for (const callback of this._events[event as string]) {
  //     callback(...args);
  //   }
  // }

  protected onEventListenerAdded<Event extends keyof Events>(event: Event, callback: Events[Event]): void {
    // do nothing
  }

  protected onEventListenerRemoved<Event extends keyof Events>(event: Event, callback: Events[Event]): void {
    // do nothing
  }
}
