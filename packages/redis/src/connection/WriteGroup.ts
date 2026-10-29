import type { Admission, Ticket } from "#/connection/Admission";

const maximumGroupBytes = 64 * 1024;

/** Only explicitly related batch tickets share a physical write. Ordinary requests keep their scheduling. */
export const takeWriteGroup = (
  queued: Ticket[],
  pending: Ticket[],
  admission: Admission,
  now: number,
) => {
  const first = queued[0];
  if (first === undefined || !admission.canWrite(first)) return undefined;

  const tickets: Ticket[] = [];
  const frames: Uint8Array[] = [];
  let bytes = 0;
  let deadlineMillis = first.deadlineMillis;

  while (true) {
    const candidate = queued[0];
    if (candidate === undefined || !admission.canWrite(candidate)) break;
    if (
      tickets.length > 0 &&
      (first.writeGroup === undefined ||
        candidate.writeGroup !== first.writeGroup ||
        bytes + candidate.bytes > maximumGroupBytes)
    )
      break;

    const frame = candidate.frame;
    if (frame === undefined) throw new Error("Missing owned request frame");

    queued.shift();
    admission.begin(candidate, now);
    // All reply slots must exist before any prefix of the compound frame can reach the socket.
    pending.push(candidate);
    tickets.push(candidate);
    frames.push(frame);
    bytes += frame.length;
    deadlineMillis = Math.min(deadlineMillis, candidate.deadlineMillis);
  }

  const single = frames[0];
  if (single === undefined) throw new Error("Empty owned write group");
  if (frames.length === 1) return { tickets, frame: single, deadlineMillis };

  let expectedOffset = single.byteOffset;
  const contiguous = frames.every((fragment) => {
    const matches = fragment.buffer === single.buffer && fragment.byteOffset === expectedOffset;
    expectedOffset += fragment.length;
    return matches;
  });
  if (contiguous) {
    return {
      tickets,
      frame: new Uint8Array(single.buffer, single.byteOffset, bytes),
      deadlineMillis,
    };
  }

  const frame = new Uint8Array(bytes);
  let offset = 0;
  for (const fragment of frames) {
    frame.set(fragment, offset);
    offset += fragment.length;
  }

  return { tickets, frame, deadlineMillis };
};
