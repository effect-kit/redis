import { Commands } from "#/index";
import { blob, bytes, commandCases } from "#test/support/commands/CoreCase";

commandCases("CONNECTION", [
  {
    label: "binary echo",
    command: Commands.echo(new Uint8Array([0, 255])),
    tokens: ["ECHO", new Uint8Array([0, 255])],
    reply: { _tag: "BlobString", value: new Uint8Array([0, 255]) },
    expected: new Uint8Array([0, 255]),
    keys: [],
  },
  {
    label: "empty ping message",
    command: Commands.pingMessage(""),
    tokens: ["PING", ""],
    reply: blob(""),
    expected: bytes(""),
    keys: [],
  },
]);
