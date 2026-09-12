import { randomBytes, randomInt } from 'crypto';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity

export function roomCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
  return out;
}

export function sessionId(): string {
  return `s_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
}

export function seed(): number {
  return randomInt(1, 2147483647);
}
