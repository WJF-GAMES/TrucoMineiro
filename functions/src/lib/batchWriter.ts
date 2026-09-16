import { WriteBatch } from 'firebase-admin/firestore';
import { db } from './admin';

/**
 * Um lote do Firestore aceita no máximo 500 operações: passar disso faz o `commit()` inteiro
 * falhar, e não parte dele. Quem apaga ou reescreve "tudo o que existe de um jogador" não sabe
 * de antemão quantos documentos são — a liga reescreve grupos inteiros, e apagar uma conta
 * percorre amizades, solicitações, bloqueios e o histórico semanal.
 */
const BATCH_LIMIT = 450;

/** Acumula escritas e comita em lotes dentro do limite do Firestore. */
export class BatchWriter {
  private batch: WriteBatch = db.batch();
  private count = 0;
  private pending: Promise<unknown>[] = [];

  private bump() {
    if (++this.count < BATCH_LIMIT) return;
    this.pending.push(this.batch.commit());
    this.batch = db.batch();
    this.count = 0;
  }

  set(
    ref: FirebaseFirestore.DocumentReference,
    data: FirebaseFirestore.DocumentData,
    merge = false,
  ) {
    this.batch.set(ref, data, { merge });
    this.bump();
  }

  update(ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData) {
    this.batch.set(ref, data, { merge: true });
    this.bump();
  }

  delete(ref: FirebaseFirestore.DocumentReference) {
    this.batch.delete(ref);
    this.bump();
  }

  async flush() {
    if (this.count > 0) this.pending.push(this.batch.commit());
    await Promise.all(this.pending);
    this.pending = [];
    this.batch = db.batch();
    this.count = 0;
  }
}
