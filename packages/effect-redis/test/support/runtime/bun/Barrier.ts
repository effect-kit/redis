import { createServer } from "node:http";
import type { ServerResponse } from "node:http";

import { Deferred, Effect } from "effect";

import { listen } from "#test/support/networking/SocketServer";

/** Coordinate an actual child runtime with independent server fault controls. */
export const runtimeBarrier = Effect.fnUntraced(function* (count: number) {
  const stages = Array.from({ length: count }, () => ({
    arrived: Deferred.makeUnsafe<void>(),
    released: false,
    responses: new Set<ServerResponse>(),
  }));
  const peer = yield* listen(
    createServer((request, response) => {
      const match = /^\/(arrive|continue)\/(\d+)$/.exec(request.url ?? "");
      const stage = match === null ? undefined : stages[Number(match[2])];
      if (stage === undefined) {
        response.writeHead(404).end();
        return;
      }

      if (match?.[1] === "arrive") {
        response.writeHead(204).end();
        Deferred.doneUnsafe(stage.arrived, Effect.void);
      } else if (stage.released) {
        response.writeHead(204).end();
      } else {
        stage.responses.add(response);
        response.once("close", () => stage.responses.delete(response));
      }
    }),
  );

  return {
    url: `http://127.0.0.1:${peer.port}`,
    arrived: (index: number) => {
      const stage = stages[index];
      return stage === undefined
        ? Effect.die("Unknown runtime stage")
        : Deferred.await(stage.arrived);
    },
    release: (index: number) =>
      Effect.sync(() => {
        const stage = stages[index];
        if (stage === undefined) throw new Error("Unknown runtime stage");
        stage.released = true;
        for (const response of stage.responses) response.writeHead(204).end();
        stage.responses.clear();
      }),
  };
});
