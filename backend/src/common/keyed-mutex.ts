/**
 * Fila por chave dentro do processo. Serializa trabalho que depois vai disputar um advisory lock
 * no Postgres: sem isso, N requisições simultâneas abrem N transações que ficam paradas no lock,
 * cada uma segurando uma conexão do pool — e o resto da API espera conexão. O advisory lock
 * continua valendo entre instâncias; aqui só evitamos a fila dentro do banco.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(fn);
    const tail = current.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await current;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  get size(): number {
    return this.tails.size;
  }
}
