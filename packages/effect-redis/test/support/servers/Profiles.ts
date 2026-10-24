import type { ServerTarget } from "../../../tools/FixtureTargets.ts";

/** Transport fixtures deliberately avoid optional module auto-loading entrypoints. */
export const serverProfile = (target: ServerTarget) => {
  switch (target.product) {
    case "dragonfly":
      return {
        executable: "dragonfly",
        port: 6379,
        command: [
          "--bind=0.0.0.0",
          "--port=6379",
          "--proactor_threads=2",
          "--maxmemory=512mb",
          "--dir=/data",
          "--force_epoll=true",
          "--logtostderr",
          "--dbfilename=",
        ],
        configuration: "dragonfly:standalone;threads=2;maxmemory=512mb",
        version: ["dragonfly", "--version"],
      };
    case "garnet":
      return {
        executable: "/app/GarnetServer",
        port: 6379,
        command: ["--bind", "0.0.0.0", "--port", "6379", "--memory", "128m", "--no-obj", "false"],
        configuration: "garnet:standalone;memory=128m",
        version: ["/app/GarnetServer", "--version"],
      };
    case "kvrocks":
      return {
        executable: "kvrocks",
        port: 6666,
        command: ["-c", "/fixture/server.conf"],
        configuration: "bind 0.0.0.0\nport 6666\ndir /data\ndaemonize no\nworkers 2\n",
        version: ["kvrocks", "--version"],
      };
    default: {
      const executable =
        target.product === "valkey"
          ? "valkey-server"
          : target.product === "keydb"
            ? "keydb-server"
            : target.product === "redict"
              ? "/bin/redict-server"
              : "redis-server";
      return {
        executable,
        port: 6379,
        command: ["/fixture/server.conf"],
        configuration: undefined,
        version: [executable, "--version"],
      };
    }
  }
};
