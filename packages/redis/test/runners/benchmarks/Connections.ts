import { Socket } from "node:net";

/** Observe connection creation, without adding a hook to every timed write/read. */
export const observeConnections = (port: number) => {
  const connect = Socket.prototype.connect;
  const active = new Set<Socket>();
  let peak = 0;

  Socket.prototype.connect = function (...args: unknown[]): Socket {
    this.once("connect", () => {
      if (this.remotePort !== port) return;
      active.add(this);
      peak = Math.max(peak, active.size);
      this.once("close", () => active.delete(this));
    });

    return Reflect.apply(connect, this, args) as Socket;
  };

  return {
    snapshot: () => ({ peak, active: active.size }),
    close: () => {
      Socket.prototype.connect = connect;
    },
  };
};
