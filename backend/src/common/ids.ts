import { createHash, randomBytes, randomInt } from 'crypto';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I

export function roomCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
  return out;
}

export function seed(): number {
  return randomInt(1, 2147483647);
}

export function opaqueToken(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

export function botKey(seat: number): string {
  return `bot_${seat}_${randomBytes(3).toString('hex')}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Chave numérica estável para `pg_advisory_xact_lock` a partir de um texto. */
export function lockKey(value: string): bigint {
  return BigInt.asIntN(64, BigInt('0x' + sha256(value).slice(0, 16)));
}
