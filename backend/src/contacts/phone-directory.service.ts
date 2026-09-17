import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AppConfig, CONFIG } from '../config/env';
import { moduleLogger } from '../common/logger';

const log = moduleLogger('contacts');

export const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Diretório de telefones. O app manda números E.164 (sem nomes) e o servidor calcula
 * `HMAC-SHA256(CONTACTS_PEPPER, e164)`: o banco guarda só hashes — um vazamento não devolve
 * telefones e o segredo nunca vai para o APK. O número do próprio usuário vem do token do Firebase
 * Auth (verificado por OTP), nunca do payload: ninguém se cadastra com o telefone de outra pessoa.
 */
@Injectable()
export class PhoneDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  hash(e164: string): string {
    return createHmac('sha256', this.config.contactsPepper).update(e164).digest('hex');
  }

  /** Grava (ou move) o índice do telefone verificado do usuário. Idempotente. */
  async index(
    userId: string,
    phoneNumber: string | null,
    db: Tx | PrismaService = this.prisma,
    /** Hash já gravado no usuário (quando o chamador já leu): igual = nada a fazer. */
    knownHash?: string | null,
  ): Promise<void> {
    if (!phoneNumber || !E164.test(phoneNumber)) return;
    const hash = this.hash(phoneNumber);
    if (knownHash === hash) return;
    const current = await db.user.findUnique({ where: { phoneHash: hash }, select: { id: true } });
    if (current?.id === userId) return;
    // O Auth não deixa duas contas com o mesmo telefone: outro dono aqui é índice velho.
    if (current) {
      log.warn('phone_index_reassigned', { from: current.id, to: userId });
      await db.user.update({ where: { id: current.id }, data: { phoneHash: null } });
    }
    try {
      await db.user.update({ where: { id: userId }, data: { phoneHash: hash } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        log.warn('phone_index_race', { userId });
        return;
      }
      throw e;
    }
  }

  /** `hash -> userId` para os hashes informados. */
  async owners(
    hashes: string[],
    db: Tx | PrismaService = this.prisma,
  ): Promise<Map<string, string>> {
    if (hashes.length === 0) return new Map();
    const rows = await db.user.findMany({
      where: { phoneHash: { in: hashes } },
      select: { id: true, phoneHash: true },
    });
    return new Map(rows.map((r) => [r.phoneHash!, r.id]));
  }

  async drop(userId: string, hash: string) {
    await this.prisma.user.updateMany({
      where: { id: userId, phoneHash: hash },
      data: { phoneHash: null },
    });
  }
}
