import { Option } from "effect";

import * as C from "#/commands/geo/index";
import {
  array,
  blob,
  bytes,
  commandCases,
  integer,
  missing,
} from "#test/support/commands/CoreCase";

const query = {
  origin: { member: "a" },
  area: { radius: 5, unit: "km" as const },
  order: "ASC" as const,
  count: { value: 2, any: true },
};
const search = ["FROMMEMBER", "a", "BYRADIUS", "5", "km", "ASC", "COUNT", "2", "ANY"];

commandCases("CORE-GEO", [
  {
    label: "GEOADD",
    command: C.geoadd("k", [{ longitude: 1, latitude: 2, member: "a" }], {
      condition: "NX",
      changed: true,
    }),
    tokens: ["GEOADD", "k", "NX", "CH", "1", "2", "a"],
    reply: integer(1n),
    expected: 1n,
    keys: [1],
  },
  {
    label: "GEOHASH nullable text",
    command: C.geohash("k", ["a", "b"]),
    tokens: ["GEOHASH", "k", "a", "b"],
    reply: array(blob("hash"), missing),
    expected: [Option.some("hash"), Option.none()],
    keys: [1],
  },
  {
    label: "GEOPOS nullable coordinates",
    command: C.geopos("k", ["a", "b"]),
    tokens: ["GEOPOS", "k", "a", "b"],
    reply: array(array(blob("1.25"), blob("2.5")), { _tag: "Null", kind: "array" }),
    expected: [Option.some([1.25, 2.5]), Option.none()],
    keys: [1],
  },
  {
    label: "GEODIST",
    command: C.geodist("k", "a", "b", "km"),
    tokens: ["GEODIST", "k", "a", "b", "km"],
    reply: blob("1.25"),
    expected: Option.some(1.25),
    keys: [1],
  },
  {
    label: "GEODIST exact token",
    command: C.geodistToken("k", "a", "b"),
    tokens: ["GEODIST", "k", "a", "b", "m"],
    reply: blob("1.2500"),
    expected: Option.some("1.2500"),
    keys: [1],
  },
  {
    label: "GEOSEARCH member/radius/count",
    command: C.geosearch("k", query),
    tokens: ["GEOSEARCH", "k", ...search],
    reply: array(blob("a")),
    expected: [bytes("a")],
    keys: [1],
  },
  {
    label: "GEOSEARCH coordinates/box",
    command: C.geosearch("k", {
      origin: { longitude: 1, latitude: 2 },
      area: { width: 3, height: 4, unit: "m" },
    }),
    tokens: ["GEOSEARCH", "k", "FROMLONLAT", "1", "2", "BYBOX", "3", "4", "m"],
    reply: array(),
    expected: [],
    keys: [1],
  },
  {
    label: "GEOSEARCH details fixed order",
    command: C.geosearchWith("k", query, { coordinates: true, hash: true, distance: true }),
    tokens: ["GEOSEARCH", "k", ...search, "WITHDIST", "WITHHASH", "WITHCOORD"],
    reply: array(array(blob("a"), blob("1.25"), integer(123n), array(blob("1"), blob("2")))),
    expected: [
      {
        member: bytes("a"),
        distance: Option.some(1.25),
        hash: Option.some(123n),
        coordinates: Option.some([1, 2]),
      },
    ],
    keys: [1],
  },
  {
    label: "GEOSEARCHSTORE",
    command: C.geosearchstore("out", "k", query, true),
    tokens: ["GEOSEARCHSTORE", "out", "k", ...search, "STOREDIST"],
    reply: integer(1n),
    expected: 1n,
    keys: [1, 2],
  },
  {
    label: "GEORADIUS",
    command: C.georadius("k", 1, 2, 3, "m"),
    tokens: ["GEORADIUS", "k", "1", "2", "3", "m"],
    reply: array(blob("a")),
    expected: [bytes("a")],
    keys: [1],
  },
  {
    label: "GEORADIUS_RO",
    command: C.georadiusRo("k", 1, 2, 3, "m"),
    tokens: ["GEORADIUS_RO", "k", "1", "2", "3", "m"],
    reply: array(),
    expected: [],
    keys: [1],
  },
  {
    label: "GEORADIUSBYMEMBER",
    command: C.georadiusbymember("k", "a", 3, "m"),
    tokens: ["GEORADIUSBYMEMBER", "k", "a", "3", "m"],
    reply: array(),
    expected: [],
    keys: [1],
  },
  {
    label: "GEORADIUSBYMEMBER_RO",
    command: C.georadiusbymemberRo("k", "a", 3, "m"),
    tokens: ["GEORADIUSBYMEMBER_RO", "k", "a", "3", "m"],
    reply: array(),
    expected: [],
    keys: [1],
  },
  {
    label: "GEORADIUS details read-only",
    command: C.georadiusWith("k", { member: "a" }, 3, "m", { distance: true }, {}, true),
    tokens: ["GEORADIUSBYMEMBER_RO", "k", "a", "3", "m", "WITHDIST"],
    reply: array(array(blob("a"), blob("1"))),
    expected: [
      {
        member: bytes("a"),
        distance: Option.some(1),
        hash: Option.none(),
        coordinates: Option.none(),
      },
    ],
    keys: [1],
  },
  {
    label: "GEORADIUS store key location",
    command: C.georadiusStore("k", "out", { member: "a" }, 3, "m", {}, true),
    tokens: ["GEORADIUSBYMEMBER", "k", "a", "3", "m", "STOREDIST", "out"],
    reply: integer(1n),
    expected: 1n,
    keys: [1, 6],
  },
]);
