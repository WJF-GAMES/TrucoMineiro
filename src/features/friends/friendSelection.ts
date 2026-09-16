/**
 * Seleção de amigos para jogar junto (mesa 2x2: o dono + até 3 amigos; o que faltar vira IA).
 * Pura: a tela só guarda a lista e chama estas funções.
 */
export const MAX_INVITE_FRIENDS = 3;

export interface ToggleResult {
  next: string[];
  /** Tentou passar do limite: a lista não mudou. */
  limited: boolean;
}

/** Marca ou desmarca mantendo a ordem de escolha (é ela que decide os assentos). */
export function toggleFriend(selected: readonly string[], uid: string): ToggleResult {
  if (selected.includes(uid)) return { next: selected.filter((u) => u !== uid), limited: false };
  if (selected.length >= MAX_INVITE_FRIENDS) return { next: [...selected], limited: true };
  return { next: [...selected, uid], limited: false };
}

export const selectionCounter = (count: number) =>
  `${count} de ${MAX_INVITE_FRIENDS} selecionado${count === 1 ? '' : 's'}`;

/** Com o limite atingido, só quem já está marcado continua clicável. */
export const isSelectionLocked = (selected: readonly string[], uid: string) =>
  selected.length >= MAX_INVITE_FRIENDS && !selected.includes(uid);

/** Como a mesa vai ficar: quantos humanos e quantas vagas a IA completa se ninguém faltar. */
export function tablePreview(count: number): string {
  const ai = Math.max(0, MAX_INVITE_FRIENDS - count);
  if (count === 0) return 'Escolha até 3 amigos';
  return ai === 0
    ? 'Mesa completa: 4 jogadores'
    : `Você + ${count} · ${ai} ${ai === 1 ? 'vaga' : 'vagas'} com IA`;
}
