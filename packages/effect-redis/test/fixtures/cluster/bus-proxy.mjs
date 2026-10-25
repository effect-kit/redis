import dns from "node:dns";
import http from "node:http";
import net from "node:net";

const links = new Set();
const blockedTargets = new Set();
const blockedSources = new Set();
const servers = [];

for (let index = 0; index < 6; index++) {
  for (const [front, backend] of [
    [7000 + index, 6379],
    [17000 + index, 16379],
  ]) {
    const server = net.createServer((incoming) => {
      const source = incoming.remoteAddress?.replace(/^::ffff:/, "");
      if (links.size >= 256 || blockedTargets.has(index) || blockedSources.has(source)) {
        incoming.destroy();
        return;
      }

      incoming.pause();
      const link = { index, source, incoming, outgoing: undefined };
      links.add(link);
      const retire = () => {
        incoming.destroy();
        link.outgoing?.destroy();
        links.delete(link);
      };
      incoming.on("error", retire);
      incoming.on("close", retire);

      dns.lookup(`node-${index}`, (error, address) => {
        if (error) {
          retire();
          return;
        }
        if (incoming.destroyed || blockedTargets.has(index) || blockedSources.has(source)) {
          retire();
          return;
        }
        const outgoing = net.createConnection({ host: address, port: backend });
        link.outgoing = outgoing;
        outgoing.on("error", retire);
        outgoing.on("close", retire);
        incoming.pipe(outgoing);
        outgoing.pipe(incoming);
      });
    });
    server.listen(front, "0.0.0.0");
    servers.push(server);
  }
}

const control = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://fixture");
  const match = /^\/cut\/([0-5])$/.exec(url.pathname);
  if (request.method === "POST" && match) {
    const index = Number(match[1]);
    const source = url.searchParams.get("source");
    blockedTargets.add(index);
    if (source) blockedSources.add(source);
    for (const link of links) {
      if (link.index !== index && link.source !== source) continue;
      link.incoming.destroy();
      link.outgoing?.destroy();
    }
  } else if (request.method === "POST" && url.pathname === "/heal") {
    blockedTargets.clear();
    blockedSources.clear();
  } else if (request.method !== "GET" || url.pathname !== "/health") {
    response.writeHead(400).end();
    return;
  }

  response
    .writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify({ links: links.size, blocked: blockedTargets.size }));
});
control.listen(18080, "0.0.0.0");

process.once("SIGTERM", () => {
  for (const link of links) {
    link.incoming.destroy();
    link.outgoing?.destroy();
  }
  for (const server of servers) server.close();
  control.close();
});
