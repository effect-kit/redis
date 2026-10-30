interface Block {
  readonly bytes: Uint8Array;
  used: number;
}

interface QueueBlock extends Block {
  readonly reusable: boolean;
}

/** Owned blocks avoid both caller-buffer aliasing and one allocation per tiny feed. */
export class ByteQueue {
  private blocks: Array<QueueBlock | undefined> = [];
  private head = 0;
  private cursor = 0;
  private spare: QueueBlock | undefined;

  size = 0;
  offset = 0;
  constructor(private readonly blockSize: number) {}

  append(bytes: Uint8Array): void {
    let offset = 0;
    while (offset < bytes.length) {
      let tail = this.blocks.at(-1);
      if (tail === undefined || tail.used === tail.bytes.length) {
        tail = this.spare ?? { bytes: new Uint8Array(this.blockSize), used: 0, reusable: true };
        this.spare = undefined;
        this.blocks.push(tail);
      }
      const count = Math.min(bytes.length - offset, tail.bytes.length - tail.used);
      tail.bytes.set(bytes.subarray(offset, offset + count), tail.used);
      tail.used += count;
      offset += count;
      this.size += count;
    }
  }

  /** Private native input has transferred ownership; it must never become reusable scratch. */
  appendOwned(bytes: Uint8Array): void {
    if (bytes.length === 0) return;

    this.blocks.push({ bytes, used: bytes.length, reusable: false });
    this.size += bytes.length;
  }

  readByte(): number | undefined {
    const block = this.blocks[this.head];
    if (block === undefined) return undefined;

    const byte = block.bytes[this.cursor];
    this.consume(1, block);

    return byte;
  }

  /** Complete contiguous headers need no incremental builder or scratch block. */
  readLine(maximum: number): Uint8Array | undefined {
    const block = this.blocks[this.head];
    if (block === undefined) return undefined;
    const end = Math.min(block.used - 1, this.cursor + maximum);
    for (let index = this.cursor; index < end; index++) {
      const byte = block.bytes[index];
      if (byte === 10) return undefined;
      if (byte !== 13) continue;
      if (block.bytes[index + 1] !== 10) return undefined;
      const bytes = block.bytes.slice(this.cursor, index);
      this.consume(index + 2 - this.cursor, block);
      return bytes;
    }
    return undefined;
  }

  copyTo(builder: ByteOutput, maximum: number): number {
    let copied = 0;

    while (copied < maximum && this.size > 0) {
      const block = this.blocks[this.head];
      if (block === undefined) throw new Error("Byte queue ownership invariant");

      const count = Math.min(maximum - copied, block.used - this.cursor);
      builder.append(block.bytes.subarray(this.cursor, this.cursor + count));
      this.consume(count, block);
      copied += count;
    }

    return copied;
  }

  clear(): void {
    this.blocks = [];
    this.head = 0;
    this.cursor = 0;
    this.size = 0;
    this.spare = undefined;
  }

  private consume(count: number, block: QueueBlock): void {
    this.size -= count;
    this.offset += count;
    this.cursor += count;

    if (this.cursor !== block.used) return;

    this.blocks[this.head++] = undefined;
    if (block.reusable) {
      // Retained scratch must not keep a previous payload. Transferred input is
      // discarded instead, and never becomes scratch or a public reply buffer.
      block.bytes.fill(0, 0, block.used);
      block.used = 0;
      this.spare = block;
    }
    this.cursor = 0;

    if (this.size === 0) {
      this.blocks = [];
      this.head = 0;
    } else if (this.head >= 1024 && this.head * 2 >= this.blocks.length) {
      this.blocks = this.blocks.slice(this.head);
      this.head = 0;
    }
  }
}

/** Payload fragments are copied into blocks and joined exactly once at completion. */
export class ByteBuilder {
  private readonly blocks: Array<Block> = [];

  length = 0;
  constructor(private readonly blockSize: number) {}

  append(bytes: Uint8Array): void {
    let offset = 0;
    while (offset < bytes.length) {
      let tail = this.blocks.at(-1);
      if (tail === undefined || tail.used === tail.bytes.length) {
        tail = { bytes: new Uint8Array(this.blockSize), used: 0 };
        this.blocks.push(tail);
      }
      const count = Math.min(bytes.length - offset, tail.bytes.length - tail.used);
      tail.bytes.set(bytes.subarray(offset, offset + count), tail.used);
      tail.used += count;
      offset += count;
      this.length += count;
    }
  }

  push(byte: number): void {
    let tail = this.blocks.at(-1);
    if (tail === undefined || tail.used === tail.bytes.length) {
      tail = { bytes: new Uint8Array(this.blockSize), used: 0 };
      this.blocks.push(tail);
    }
    tail.bytes[tail.used++] = byte;
    this.length++;
  }

  finish(): Uint8Array {
    const single = this.blocks[0];
    // A completed blob owns these exact-sized bytes; its builder is no longer reused.
    if (this.blocks.length === 1 && single?.bytes.length === this.length) return single.bytes;

    const bytes = new Uint8Array(this.length);
    let offset = 0;

    for (const block of this.blocks) {
      bytes.set(block.bytes.subarray(0, block.used), offset);
      offset += block.used;
    }

    return bytes;
  }
}

export interface ByteOutput {
  readonly length: number;
  append(bytes: Uint8Array): void;
  finish(): Uint8Array;
}

/** Only validated, bounded length declarations allocate their exact output immediately. */
export class ContiguousBytes implements ByteOutput {
  private readonly bytes: Uint8Array;
  length = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
  }

  append(bytes: Uint8Array): void {
    this.bytes.set(bytes, this.length);
    this.length += bytes.length;
  }

  finish(): Uint8Array {
    if (this.length !== this.bytes.length) throw new Error("Incomplete contiguous blob");
    return this.bytes;
  }
}
