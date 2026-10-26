import type { RedisArgument } from "#/RedisArgument";

const utf8 = new TextEncoder();

/** Hash tags use the first opening brace and its first closing brace, including empty tags. */
export const keySlot = (key: RedisArgument): number => {
  const bytes = typeof key === "string" ? utf8.encode(key) : key;
  const opening = bytes.indexOf(123);
  const closing = opening < 0 ? -1 : bytes.indexOf(125, opening + 1);
  const selected = closing > opening + 1 ? bytes.subarray(opening + 1, closing) : bytes;
  let crc = 0;

  for (const byte of selected) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++)
      crc = ((crc << 1) ^ ((crc & 0x8000) === 0 ? 0 : 0x1021)) & 0xffff;
  }

  return crc & 0x3fff;
};
