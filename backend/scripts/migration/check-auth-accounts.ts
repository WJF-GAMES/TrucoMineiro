/**
 * Confere quais uids do backup ainda têm conta no Firebase Auth (somente leitura).
 * Imprime apenas contagens e uids — nunca telefone.
 *
 *   npx ts-node --transpile-only scripts/migration/check-auth-accounts.ts <dir> [--use-firebase-cli-login]
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { GoogleAuth, UserRefreshClient } from 'google-auth-library';
import { readNdjson } from './postgres-import';

async function token(useCli: boolean): Promise<string> {
  if (useCli) {
    const store = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
    if (!existsSync(store)) throw new Error('Sessão da Firebase CLI não encontrada.');
    const refresh = (JSON.parse(readFileSync(store, 'utf8')) as { tokens?: { refresh_token?: string } }).tokens?.refresh_token;
    const npmRoot = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules') : '/usr/local/lib/node_modules';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = require(join(npmRoot, 'firebase-tools', 'lib', 'api.js')) as { clientId: () => string; clientSecret: () => string };
    return (await new UserRefreshClient(api.clientId(), api.clientSecret(), refresh).getAccessToken()).token!;
  }
  const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  return (await client.getAccessToken()).token!;
}

async function main() {
  const dir = process.argv[2]!;
  const project = 'truco-mineiro-wjf';
  const users = new Set((await readNdjson(dir, 'users')).map((d) => d.id));
  const profiles = (await readNdjson(dir, 'profiles')).map((d) => d.id);
  const all = [...new Set([...users, ...profiles])];
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await token(process.argv.includes('--use-firebase-cli-login'))}`, 'content-type': 'application/json', 'x-goog-user-project': project },
    body: JSON.stringify({ localId: all }),
  });
  if (!res.ok) throw new Error(`Auth lookup ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { users?: { localId: string; phoneNumber?: string; disabled?: boolean }[] };
  const alive = new Map((body.users ?? []).map((u) => [u.localId, u]));
  const rows = all.map((uid) => ({
    uid,
    usersDoc: users.has(uid),
    profileDoc: profiles.includes(uid),
    authAccount: alive.has(uid),
    hasPhone: Boolean(alive.get(uid)?.phoneNumber),
  }));
  console.table(rows);
  writeFileSync(join(dir, 'auth-accounts.json'), JSON.stringify(rows, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
