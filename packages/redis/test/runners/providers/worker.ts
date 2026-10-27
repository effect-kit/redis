import { Cause, Effect } from "effect";

import { runHttp } from "#test/runners/providers/Http";
import { workerInput } from "#test/runners/providers/WorkerRequest";
import { workerResponse } from "#test/runners/providers/WorkerResponse";
import { safeFailure } from "#test/support/providers/Failures";

interface Bindings {
  readonly UPSTASH_URL: string;
  readonly UPSTASH_TOKEN: string;
  readonly RUN_KEY: string;
  readonly RUN_EXPIRES_AT: string;
  readonly COMPATIBILITY_DATE: string;
  readonly VERSION: { readonly id: string };
}

const unauthorized = () => new Response(null, { status: 403 });

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const reply = (response: Response) => workerResponse(response, env.VERSION?.id);
    if (
      !env.RUN_KEY ||
      !Number.isFinite(Number(env.RUN_EXPIRES_AT)) ||
      Date.now() >= Number(env.RUN_EXPIRES_AT) ||
      request.headers.get("authorization") !== `Bearer ${env.RUN_KEY}`
    )
      return reply(unauthorized());
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/ready")
      return reply(Response.json({ ready: true, version: env.VERSION.id }));
    if (request.method !== "POST" || path !== "/test")
      return reply(new Response(null, { status: 404 }));
    const input = await workerInput(request);
    if (input === "too-large") return reply(new Response(null, { status: 413 }));
    if (input === "invalid") return reply(new Response(null, { status: 400 }));

    const exit = await Effect.runPromiseExit(
      runHttp(
        {
          ...input,
          url: env.UPSTASH_URL,
          token: env.UPSTASH_TOKEN,
        },
        "workers",
        `compatibility-${env.COMPATIBILITY_DATE}`,
      ),
    );
    if (exit._tag === "Failure")
      return reply(
        Response.json({ error: safeFailure(Cause.squash(exit.cause)) }, { status: 500 }),
      );
    return reply(Response.json({ ...exit.value, deployment: env.VERSION.id }));
  },
};
