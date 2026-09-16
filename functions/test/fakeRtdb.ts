/**
 * Realtime Database em memória: ref/child, get, set, update (inclusive multi-caminho na raiz),
 * remove, transaction e orderByChild().equalTo(). Como o RTDB real, `null` apaga e objetos
 * vazios somem. Serve para testar salas, convites e sessões sem subir o emulador.
 */

type Json = unknown;

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function prune(v: Json): Json {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return v;
  const out: Record<string, Json> = {};
  for (const [k, child] of Object.entries(v as Record<string, Json>)) {
    const c = prune(child);
    if (c !== null) out[k] = c;
  }
  return Object.keys(out).length ? out : null;
}

class Snapshot {
  constructor(
    readonly key: string | null,
    private readonly value: Json,
  ) {}
  exists() {
    return this.value !== null && this.value !== undefined;
  }
  val() {
    return clone(this.value ?? null);
  }
  forEach(fn: (child: Snapshot) => void) {
    if (!this.value || typeof this.value !== 'object') return false;
    for (const [k, v] of Object.entries(this.value as Record<string, Json>)) fn(new Snapshot(k, v));
    return false;
  }
}

export class FakeRtdb {
  root: Json = null;
  /** Hook opcional para simular escrita concorrente antes de uma transação. */
  beforeTransaction: ((path: string) => void) | null = null;

  read(path: string): Json {
    let cur: Json = this.root;
    for (const part of split(path)) {
      if (!cur || typeof cur !== 'object') return null;
      cur = (cur as Record<string, Json>)[part];
    }
    return cur ?? null;
  }

  write(path: string, value: Json) {
    const parts = split(path);
    if (parts.length === 0) {
      this.root = prune(clone(value));
      return;
    }
    const root = (this.root && typeof this.root === 'object' ? this.root : {}) as Record<
      string,
      Json
    >;
    let cur = root;
    for (const part of parts.slice(0, -1)) {
      if (!cur[part] || typeof cur[part] !== 'object') cur[part] = {};
      cur = cur[part] as Record<string, Json>;
    }
    cur[parts[parts.length - 1]!] = clone(value);
    this.root = prune(root);
  }

  ref(path = ''): FakeRef {
    return new FakeRef(this, path);
  }
}

class FakeQuery {
  constructor(
    protected readonly db: FakeRtdb,
    readonly path: string,
    private readonly orderKey: string | null = null,
    private readonly equals: Json = undefined,
  ) {}
  orderByChild(child: string) {
    return new FakeQuery(this.db, this.path, child);
  }
  equalTo(value: Json) {
    return new FakeQuery(this.db, this.path, this.orderKey, value);
  }
  async get() {
    const value = this.db.read(this.path);
    if (this.orderKey === null || this.equals === undefined || !value || typeof value !== 'object')
      return new Snapshot(split(this.path).pop() ?? null, value);
    const filtered: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value as Record<string, Json>)) {
      if ((v as Record<string, Json>)?.[this.orderKey] === this.equals) filtered[k] = v;
    }
    return new Snapshot(
      split(this.path).pop() ?? null,
      Object.keys(filtered).length ? filtered : null,
    );
  }
}

export class FakeRef extends FakeQuery {
  child(sub: string) {
    return new FakeRef(this.db, `${this.path}/${sub}`);
  }
  async set(value: Json) {
    this.db.write(this.path, value);
  }
  async remove() {
    this.db.write(this.path, null);
  }
  async update(values: Record<string, Json>) {
    for (const [k, v] of Object.entries(values)) this.db.write(`${this.path}/${k}`, v);
  }
  async transaction(fn: (current: Json) => Json) {
    this.db.beforeTransaction?.(this.path);
    const current = clone(this.db.read(this.path));
    const next = fn(current);
    if (next === undefined) {
      return { committed: false, snapshot: new Snapshot(null, this.db.read(this.path)) };
    }
    this.db.write(this.path, next);
    return { committed: true, snapshot: new Snapshot(null, this.db.read(this.path)) };
  }
}
