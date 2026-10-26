import assert from "node:assert/strict";

import { Effect, Option } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

export const structures = Effect.fnUntraced(function* ({
  prefix,
  check,
  policy,
  rejected,
}: Client) {
  const C = core.Commands;
  const bloom = `${prefix}:bloom`;
  const binary = new Uint8Array([0, 255]);

  yield* check("bloom.reserve", C.bfReserve(bloom, 0.001, 100), undefined);
  yield* check("bloom.add", C.bfAdd(bloom, binary), true);
  yield* check("bloom.exists", C.bfExists(bloom, binary), true);
  yield* check("bloom.multi-order", C.bfMexists(bloom, [binary, binary]), [true, true]);
  yield* check("bloom.card", C.bfCard(bloom), 1n);

  const cuckoo = `${prefix}:cuckoo`;
  yield* check("cuckoo.reserve", C.cfReserve(cuckoo, 100), undefined);
  yield* check("cuckoo.add", C.cfAdd(cuckoo, binary), true);
  yield* check("cuckoo.exists", C.cfExists(cuckoo, binary), true);
  yield* check("cuckoo.delete", C.cfDel(cuckoo, binary), true);

  const cms = `${prefix}:cms`;
  yield* check("cms.init", C.cmsInitbydim(cms, 100, 5), undefined);
  yield* check("cms.increment", C.cmsIncrby(cms, [[binary, 2]]), [2n]);
  yield* check("cms.query", C.cmsQuery(cms, [binary]), [2n]);

  const top = `${prefix}:top`;
  yield* check("topk.reserve", C.topkReserve(top, 3), undefined);
  yield* check("topk.add", C.topkAdd(top, [binary]), [Option.none()]);
  yield* check("topk.query", C.topkQuery(top, [binary]), [true]);

  const td = `${prefix}:tdigest`;
  yield* check("tdigest.create", C.tdigestCreate(td), undefined);
  yield* check("tdigest.add", C.tdigestAdd(td, [1, 2, 3]), undefined);
  yield* check("tdigest.minimum", C.tdigestMin(td), 1);
  yield* check("tdigest.maximum", C.tdigestMax(td), 3);

  const ts = `${prefix}:timeseries`;
  yield* check("timeseries.create", C.tsCreate(ts), undefined);
  yield* check("timeseries.add", C.tsAdd(ts, 1, 2), 1n);
  yield* check("timeseries.get", C.tsGet(ts), Option.some({ timestamp: 1n, value: 2 }));

  const vector = `${prefix}:vectors`;
  if (policy.engine === "garnet") {
    const disabled = /^ERR Vector Set \(preview\) commands are not enabled$/;
    yield* rejected(
      "vectors.disabled-add",
      C.vadd(vector, { _tag: "Values", coordinates: [1, 0, 0] }, binary),
      disabled,
    );
    yield* rejected("vectors.disabled-cardinality", C.vcard(vector), disabled);
    yield* rejected("vectors.disabled-embedding", C.vemb(vector, binary), disabled);
    return;
  }
  yield* check(
    "vectors.add",
    C.vadd(vector, { _tag: "Values", coordinates: [1, 0, 0] }, binary, { quantization: "NOQUANT" }),
    true,
  );
  yield* check("vectors.cardinality", C.vcard(vector), 1n);
  yield* check("vectors.embedding", C.vemb(vector, binary), (value) => {
    assert.ok(Option.isSome(value));
    assert.deepEqual(value.value, [1, 0, 0]);
  });
});
