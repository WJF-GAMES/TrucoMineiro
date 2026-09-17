import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { applyTestEnv, TEST_DATABASE_URL } from './test-env';
import { seedStructural } from '../../prisma/seed';

/** Aplica as migrations no banco de teste e o seed estrutural (uma vez por execução). */
export default async function globalSetup() {
  applyTestEnv();
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
  const prisma = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
  try {
    await seedStructural(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
