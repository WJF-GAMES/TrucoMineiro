/**
 * Exportação SOMENTE LEITURA do Firebase antigo (Firestore via REST) para arquivos NDJSON.
 * É o backup obrigatório antes de qualquer migração — nada é apagado nem escrito no Firebase.
 *
 * Credencial (em ordem):
 *  1. GOOGLE_APPLICATION_CREDENTIALS (service account com Datastore Viewer) ou ADC do gcloud;
 *  2. `--use-firebase-cli-login`: reaproveita a sessão da Firebase CLI da máquina (`firebase login`).
 */
import { createHash } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { GoogleAuth, UserRefreshClient } from 'google-auth-library';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface ExportedDoc {
  /** Caminho relativo (`users/abc`, `friendships/a/friends/b`). */
  path: string;
  id: string;
  data: Record<string, Json>;
}

/** Coleções de topo exportadas. */
export const TOP_LEVEL = [
  'users',
  'profiles',
  'playerStats',
  'userAchievements',
  'matchHistory',
  'playerProgress',
  'weeklyLeagueGroups',
  'friendRequests',
  'phoneIndex',
  'friendInviteTokens',
  'processedLeagueEvents',
  'leagueDefinitions',
  'achievements',
  'contactSync',
] as const;

/** Subcoleções lidas por collection group (o documento pai pode nem existir). */
export const GROUPS: { id: string; parent: string; file: string }[] = [
  { id: 'friends', parent: 'friendships', file: 'friendships.friends' },
  { id: 'blocked', parent: 'blocks', file: 'blocks.blocked' },
  { id: 'users', parent: 'autoConnectSuppressed', file: 'autoConnectSuppressed.users' },
  { id: 'members', parent: 'weeklyLeagueGroups', file: 'weeklyLeagueGroups.members' },
  { id: 'weeks', parent: 'leagueHistory', file: 'leagueHistory.weeks' },
];

interface FirestoreValue {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  stringValue?: string;
  bytesValue?: string;
  referenceValue?: string;
  geoPointValue?: { latitude: number; longitude: number };
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
}

export function decodeValue(v: FirestoreValue): Json {
  if ('nullValue' in v) return null;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.timestampValue !== undefined) return Date.parse(v.timestampValue);
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.bytesValue !== undefined) return v.bytesValue;
  if (v.referenceValue !== undefined) return v.referenceValue;
  if (v.geoPointValue) return v.geoPointValue;
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(decodeValue);
  if (v.mapValue) return decodeFields(v.mapValue.fields ?? {});
  return null;
}

export function decodeFields(fields: Record<string, FirestoreValue>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v);
  return out;
}

async function accessTokenProvider(useCliLogin: boolean): Promise<() => Promise<string>> {
  if (useCliLogin) {
    const store = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
    if (!existsSync(store)) throw new Error('Sessão da Firebase CLI não encontrada (rode `firebase login`).');
    const refresh = (JSON.parse(readFileSync(store, 'utf8')) as { tokens?: { refresh_token?: string } }).tokens
      ?.refresh_token;
    if (!refresh) throw new Error('Sessão da Firebase CLI sem refresh token.');
    const npmRoot = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules') : '/usr/local/lib/node_modules';
    // Cliente OAuth público da própria Firebase CLI (lido do pacote instalado, não copiado aqui).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cliApi = require(join(npmRoot, 'firebase-tools', 'lib', 'api.js')) as {
      clientId: () => string;
      clientSecret: () => string;
    };
    const client = new UserRefreshClient(cliApi.clientId(), cliApi.clientSecret(), refresh);
    return async () => (await client.getAccessToken()).token!;
  }
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
  const client = await auth.getClient();
  return async () => (await client.getAccessToken()).token!;
}

export interface ExportManifest {
  projectId: string;
  exportedAt: string;
  files: Record<string, { count: number; sha256: string }>;
}

export async function exportFirestore(opts: {
  projectId: string;
  outDir: string;
  useCliLogin: boolean;
  log?: (msg: string) => void;
}): Promise<ExportManifest> {
  const log = opts.log ?? (() => undefined);
  const token = await accessTokenProvider(opts.useCliLogin);
  const base = `https://firestore.googleapis.com/v1/projects/${opts.projectId}/databases/(default)/documents`;
  mkdirSync(opts.outDir, { recursive: true });
  const manifest: ExportManifest = { projectId: opts.projectId, exportedAt: new Date().toISOString(), files: {} };

  const call = async (url: string, init: RequestInit = {}) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        ...init,
        headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
      });
      if (res.ok) return res.json() as Promise<unknown>;
      if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      throw new Error(`Firestore ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  };

  const writer = (file: string) => {
    const path = join(opts.outDir, `${file}.ndjson`);
    mkdirSync(dirname(path), { recursive: true });
    const stream = createWriteStream(path, { encoding: 'utf8' });
    const hash = createHash('sha256');
    let count = 0;
    return {
      write(doc: ExportedDoc) {
        const line = JSON.stringify(doc) + '\n';
        hash.update(line);
        stream.write(line);
        count++;
      },
      async close() {
        await new Promise<void>((r) => stream.end(r));
        manifest.files[file] = { count, sha256: hash.digest('hex') };
        log(`  ${file}: ${count}`);
      },
    };
  };

  const relative = (name: string) => name.split('/documents/')[1] ?? name;

  for (const collection of TOP_LEVEL) {
    const w = writer(collection);
    let pageToken = '';
    do {
      const url = `${base}/${collection}?pageSize=300&showMissing=false${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const page = (await call(url)) as {
        documents?: { name: string; fields?: Record<string, FirestoreValue> }[];
        nextPageToken?: string;
      };
      for (const d of page.documents ?? []) {
        const path = relative(d.name);
        w.write({ path, id: path.split('/').pop()!, data: decodeFields(d.fields ?? {}) });
      }
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
    await w.close();
  }

  for (const group of GROUPS) {
    const w = writer(group.file);
    let cursor: string | null = null;
    for (;;) {
      const body = {
        structuredQuery: {
          from: [{ collectionId: group.id, allDescendants: true }],
          orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
          limit: 500,
          ...(cursor ? { startAt: { values: [{ referenceValue: cursor }], before: false } } : {}),
        },
      };
      const rows = (await call(`${base}:runQuery`, { method: 'POST', body: JSON.stringify(body) })) as {
        document?: { name: string; fields?: Record<string, FirestoreValue> };
      }[];
      const docs = rows.map((r) => r.document).filter((d): d is NonNullable<typeof d> => Boolean(d));
      if (docs.length === 0) break;
      for (const d of docs) {
        const path = relative(d.name);
        // `users` também é coleção de topo: só a subcoleção do pai certo interessa.
        if (!path.startsWith(`${group.parent}/`)) continue;
        w.write({ path, id: path.split('/').pop()!, data: decodeFields(d.fields ?? {}) });
      }
      cursor = docs[docs.length - 1]!.name;
      if (docs.length < 500) break;
    }
    await w.close();
  }

  writeFileSync(join(opts.outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
