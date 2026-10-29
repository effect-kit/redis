export interface Deadline {
  readonly at: number;
  readonly order: number;
  readonly expire: () => void;
  index: number;
}

/** Indexed removal keeps completed requests out of the heap, without retained tombstones. */
export class DeadlineHeap {
  private readonly entries: Deadline[] = [];

  get size() {
    return this.entries.length;
  }

  peek() {
    return this.entries[0];
  }

  add(deadline: Deadline) {
    deadline.index = this.entries.length;
    this.entries.push(deadline);
    this.up(deadline.index);
  }

  remove(deadline: Deadline) {
    const index = deadline.index;
    if (index < 0) return;
    const last = this.entries.pop();
    deadline.index = -1;
    if (last === undefined || last === deadline) return;

    this.entries[index] = last;
    last.index = index;
    this.up(index);
    this.down(last.index);
  }

  clear() {
    for (const entry of this.entries) entry.index = -1;
    this.entries.length = 0;
  }

  private before(a: Deadline, b: Deadline) {
    return a.at < b.at || (a.at === b.at && a.order < b.order);
  }

  private swap(a: number, b: number) {
    const first = this.entries[a];
    const second = this.entries[b];
    if (first === undefined || second === undefined) throw new Error("Deadline heap index");
    this.entries[a] = second;
    this.entries[b] = first;
    first.index = b;
    second.index = a;
  }

  private up(start: number) {
    let index = start;
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      const entry = this.entries[index];
      const ancestor = this.entries[parent];
      if (entry === undefined || ancestor === undefined) throw new Error("Deadline heap parent");
      if (!this.before(entry, ancestor)) return;
      this.swap(index, parent);
      index = parent;
    }
  }

  private down(start: number) {
    let index = start;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      const entry = this.entries[index];
      const a = this.entries[left];
      const b = this.entries[right];
      if (entry === undefined || a === undefined) return;
      const child = b !== undefined && this.before(b, a) ? right : left;
      const candidate = this.entries[child];
      if (candidate === undefined || !this.before(candidate, entry)) return;
      this.swap(index, child);
      index = child;
    }
  }
}
