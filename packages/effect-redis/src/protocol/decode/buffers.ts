interface Block {
  readonly bytes: Uint8Array;
  used: number;
}

/** Owned blocks avoid both caller-buffer aliasing and one allocation per tiny feed. */
export class ByteQueue {
  private blocks: Array<Block | undefined> = [];
  private head = 0;
  private cursor = 0;
  private spare: Block | undefined;
  size = 0;
  offset = 0;
  constructor(private readonly blockSize: number) {}

  append(bytes: Uint8Array): void {
    let offset = 0;
    while (offset < bytes.length) {
      let tail = this.blocks.at(-1);
      if (tail === undefined || tail.used === tail.bytes.length) {
        tail = this.spare ?? { bytes: new Uint8Array(this.blockSize), used: 0 };
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

  readByte(): number | undefined {
    const block = this.blocks[this.head];
    if (block === undefined) return undefined;
    const byte = block.bytes[this.cursor];
    this.consume(1, block);
    return byte;
  }

  copyTo(builder: ByteBuilder, maximum: number): number {
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

  private consume(count: number, block: Block): void {
    this.size -= count;
    this.offset += count;
    this.cursor += count;
    if (this.cursor !== block.used) return;
    this.blocks[this.head++] = undefined;
    block.bytes.fill(0, 0, block.used);
    block.used = 0;
    this.spare = block;
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
    const bytes = new Uint8Array(this.length);
    let offset = 0;
    for (const block of this.blocks) {
      bytes.set(block.bytes.subarray(0, block.used), offset);
      offset += block.used;
    }
    return bytes;
  }
}
