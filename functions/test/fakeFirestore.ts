/**
 * Firestore em memória, só com o que o sistema de ligas usa: doc/collection, where, orderBy,
 * limit, startAfter, count, transações, batches e getAll.
 *
 * Serve para testar a lógica real das Functions (atribuição, rebalanceamento, fechamento semanal)
 * sem subir o emulador, que é lento demais para rodar em cada `npm test`.
 */

export const DOCUMENT_ID = '__name__';

type Data = Record<string, unknown>;

export class FakeFirestore {
  /** caminho completo do documento -> dados */
  readonly store = new Map<string, Data>();
  /** contadores para asserções de custo/concorrência nos testes */
  reads = 0;
  writes = 0;

  doc(path: string): FakeDocRef {
    if (path.split('/').length % 2 !== 0) throw new Error(`caminho de documento inválido: ${path}`);
    return new FakeDocRef(this, path);
  }

  collection(path: string): FakeQuery {
    if (path.split('/').length % 2 !== 1) throw new Error(`caminho de coleção inválido: ${path}`);
    return new FakeQuery(this, path);
  }

  batch(): FakeBatch {
    return new FakeBatch(this);
  }

  async getAll(...refs: FakeDocRef[]): Promise<FakeSnapshot[]> {
    return Promise.all(refs.map((r) => r.get()));
  }

  /**
   * Sem isolamento real: aplica direto. Os testes de idempotência chamam a mesma operação em
   * sequência (e em paralelo) para cobrir o que importa aqui — repetição não pode duplicar efeito.
   */
  async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    return fn(new FakeTransaction(this));
  }

  docsIn(collectionPath: string): { id: string; path: string; data: Data }[] {
    const depth = collectionPath.split('/').length + 1;
    const prefix = `${collectionPath}/`;
    const out: { id: string; path: string; data: Data }[] = [];
    for (const [path, data] of this.store) {
      if (!path.startsWith(prefix)) continue;
      if (path.split('/').length !== depth) continue;
      out.push({ id: path.slice(prefix.length), path, data });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }
}

export class FakeSnapshot {
  constructor(
    readonly id: string,
    readonly ref: FakeDocRef,
    private readonly value: Data | undefined,
  ) {}
  get exists(): boolean {
    return this.value !== undefined;
  }
  data(): Data | undefined {
    return this.value === undefined ? undefined : { ...this.value };
  }
  get(field: string): unknown {
    return this.value?.[field];
  }
}

export class FakeDocRef {
  readonly id: string;
  constructor(
    private readonly fs: FakeFirestore,
    readonly path: string,
  ) {
    this.id = path.split('/').pop()!;
  }

  collection(name: string): FakeQuery {
    return this.fs.collection(`${this.path}/${name}`);
  }

  async get(): Promise<FakeSnapshot> {
    this.fs.reads++;
    return new FakeSnapshot(this.id, this, this.fs.store.get(this.path));
  }

  async set(data: Data, options?: { merge?: boolean }): Promise<void> {
    this.fs.writes++;
    const previous = options?.merge ? (this.fs.store.get(this.path) ?? {}) : {};
    this.fs.store.set(this.path, { ...previous, ...data });
  }

  async update(data: Data): Promise<void> {
    if (!this.fs.store.has(this.path)) throw new Error(`update em documento inexistente: ${this.path}`);
    this.fs.writes++;
    this.fs.store.set(this.path, { ...this.fs.store.get(this.path)!, ...data });
  }

  async delete(): Promise<void> {
    this.fs.writes++;
    this.fs.store.delete(this.path);
  }
}

type Filter = [string, string, unknown];

export class FakeQuery {
  private filters: Filter[] = [];
  private order: { field: string; dir: 'asc' | 'desc' }[] = [];
  private max: number | null = null;
  private after: unknown = undefined;

  constructor(
    private readonly fs: FakeFirestore,
    private readonly path: string,
  ) {}

  private clone(): FakeQuery {
    const q = new FakeQuery(this.fs, this.path);
    q.filters = [...this.filters];
    q.order = [...this.order];
    q.max = this.max;
    q.after = this.after;
    return q;
  }

  where(field: string, op: string, value: unknown): FakeQuery {
    const q = this.clone();
    q.filters.push([field, op, value]);
    return q;
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): FakeQuery {
    const q = this.clone();
    q.order.push({ field, dir });
    return q;
  }

  limit(n: number): FakeQuery {
    const q = this.clone();
    q.max = n;
    return q;
  }

  startAfter(value: unknown): FakeQuery {
    const q = this.clone();
    q.after = value;
    return q;
  }

  private rows() {
    let rows = this.fs.docsIn(this.path).map((r) => ({ ...r, key: r.id }));
    for (const [field, op, value] of this.filters) {
      rows = rows.filter((r) => {
        const actual = field === DOCUMENT_ID ? r.id : r.data[field];
        switch (op) {
          case '==':
            return actual === value;
          case '!=':
            return actual !== value;
          case 'in':
            return Array.isArray(value) && value.includes(actual);
          case '>':
            return (actual as number) > (value as number);
          case '>=':
            return (actual as number) >= (value as number);
          case '<':
            return (actual as number) < (value as number);
          case '<=':
            return (actual as number) <= (value as number);
          default:
            throw new Error(`operador não suportado no fake: ${op}`);
        }
      });
    }
    const order = this.order.length ? this.order : [{ field: DOCUMENT_ID, dir: 'asc' as const }];
    rows.sort((a, b) => {
      for (const { field, dir } of order) {
        const av = field === DOCUMENT_ID ? a.id : a.data[field];
        const bv = field === DOCUMENT_ID ? b.id : b.data[field];
        if (av === bv) continue;
        const cmp =
          typeof av === 'string' && typeof bv === 'string'
            ? av.localeCompare(bv)
            : Number(av ?? 0) - Number(bv ?? 0);
        return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
    if (this.after !== undefined) {
      const field = order[0]!.field;
      const index = rows.findIndex((r) => (field === DOCUMENT_ID ? r.id : r.data[field]) === this.after);
      rows = index >= 0 ? rows.slice(index + 1) : rows;
    }
    if (this.max !== null) rows = rows.slice(0, this.max);
    return rows;
  }

  async get() {
    const rows = this.rows();
    this.fs.reads += rows.length;
    const docs = rows.map((r) => new FakeSnapshot(r.id, this.fs.doc(r.path), r.data));
    return { docs, empty: docs.length === 0, size: docs.length, forEach: (f: (d: FakeSnapshot) => void) => docs.forEach(f) };
  }

  count() {
    return { get: async () => ({ data: () => ({ count: this.rows().length }) }) };
  }
}

export class FakeTransaction {
  constructor(private readonly fs: FakeFirestore) {}
  get(ref: FakeDocRef) {
    return ref.get();
  }
  set(ref: FakeDocRef, data: Data, options?: { merge?: boolean }) {
    void ref.set(data, options);
  }
  update(ref: FakeDocRef, data: Data) {
    // O Admin SDK falha em update de doc inexistente; aqui espelhamos isso para pegar o mesmo bug.
    if (!this.fs.store.has(ref.path)) throw new Error(`update em documento inexistente: ${ref.path}`);
    void ref.update(data);
  }
  delete(ref: FakeDocRef) {
    void ref.delete();
  }
}

export class FakeBatch {
  private ops: (() => void)[] = [];
  constructor(private readonly fs: FakeFirestore) {}
  set(ref: FakeDocRef, data: Data, options?: { merge?: boolean }) {
    this.ops.push(() => void ref.set(data, options));
  }
  update(ref: FakeDocRef, data: Data) {
    this.ops.push(() => void ref.update(data));
  }
  delete(ref: FakeDocRef) {
    this.ops.push(() => void ref.delete());
  }
  async commit() {
    for (const op of this.ops) op();
    this.ops = [];
  }
}
