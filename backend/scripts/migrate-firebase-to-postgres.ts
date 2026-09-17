/**
 * Migração Firebase (Firestore) → PostgreSQL.
 *
 *   # 1) backup/export SOMENTE LEITURA (nunca apaga nada no Firebase)
 *   npm run migrate:firebase -- export --project truco-mineiro-wjf --out migration-backups/2026-09-17 [--use-firebase-cli-login]
 *   # 2) importação idempotente (rodar em STAGING primeiro)
 *   DATABASE_URL=... npm run migrate:firebase -- import --from migration-backups/2026-09-17 [--dry-run]
 *   # 3) conferência origem × destino
 *   DATABASE_URL=... npm run migrate:firebase -- validate --from migration-backups/2026-09-17
 *   # tudo em sequência
 *   DATABASE_URL=... npm run migrate:firebase -- all --project truco-mineiro-wjf --out migration-backups/<data>
 *
 * Pré-requisito: `CONTACTS_PEPPER` do backend igual ao das Functions (para os hashes de telefone
 * continuarem válidos). Ver docs/migration.md.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { exportFirestore } from './migration/firebase-export';
import { importAll, NOT_MIGRATED, validate } from './migration/postgres-import';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function table(rows: Record<string, unknown>[]) {
  console.table(rows);
}

async function main() {
  const command = process.argv[2];
  const project = arg('project') ?? 'truco-mineiro-wjf';
  const dir = arg('from') ?? arg('out');
  if (!command || !['export', 'import', 'validate', 'all'].includes(command) || !dir) {
    console.error('uso: migrate-firebase-to-postgres <export|import|validate|all> --out|--from <dir> [--project p] [--dry-run] [--use-firebase-cli-login] [--phone-pepper-matches]');
    process.exit(2);
  }

  if (command === 'export' || command === 'all') {
    console.log(`==> Export (somente leitura) de ${project} para ${dir}`);
    const manifest = await exportFirestore({
      projectId: project,
      outDir: dir,
      useCliLogin: flag('use-firebase-cli-login'),
      log: (m) => console.log(m),
    });
    console.log(`    ${Object.values(manifest.files).reduce((a, f) => a + f.count, 0)} documentos exportados`);
  }

  if (command === 'import' || command === 'validate' || command === 'all') {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não definida.');
    if (/prod/i.test(process.env.DATABASE_URL) && !flag('i-know-this-is-production'))
      throw new Error('DATABASE_URL parece ser de produção: rode antes em staging (ou passe --i-know-this-is-production).');
    const prisma = new PrismaClient();
    try {
      if (command !== 'validate') {
        const dryRun = flag('dry-run');
        console.log(`==> Import ${dryRun ? '(DRY RUN) ' : ''}de ${dir}`);
        const started = Date.now();
        const report = await importAll(prisma, dir, dryRun, { phonePepperMatches: flag('phone-pepper-matches') });
        table(
          Object.entries(report).map(([entity, r]) => ({
            entidade: entity,
            lidos: r.read,
            migrados: r.migrated,
            atualizados: r.updated,
            ignorados: r.skipped,
            duplicados: r.duplicates,
            falharam: r.failed,
            corrigidos: r.corrected,
          })),
        );
        for (const [entity, r] of Object.entries(report))
          for (const e of r.errors) console.error(`   ! ${entity}: ${e}`);
        console.log('    Não migrados (transitórios/derivados):');
        for (const [k, v] of Object.entries(NOT_MIGRATED)) console.log(`     - ${k}: ${v}`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, `import-report-${Date.now()}.json`),
          JSON.stringify({ dryRun, durationMs: Date.now() - started, report, notMigrated: NOT_MIGRATED }, null, 2),
        );
      }
      console.log('==> Validação origem × destino');
      const rows = await validate(prisma, dir);
      table(rows.map((r) => ({ entidade: r.entity, origem: r.source, destino: r.target, ok: r.ok ? 'OK' : 'DIFERENTE', nota: r.note ?? '' })));
      writeFileSync(join(dir, `validation-${Date.now()}.json`), JSON.stringify(rows, null, 2));
      if (rows.some((r) => !r.ok)) process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
