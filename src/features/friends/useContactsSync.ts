import { useCallback, useEffect, useRef, useState } from 'react';
import type { CountryCode } from 'libphonenumber-js';
import {
  ContactsReadError,
  getContactsPermission,
  readDeviceContacts,
  requestContactsPermission,
  subscribeContactsChanged,
  type ContactsPermission,
} from '@/services/contacts';
import { ApiError, syncPhoneContacts } from '@/services/api';
import { logEvent } from '@/services/firebase/analytics';
import { reportError } from '@/services/firebase/crashlytics';
import type { ContactMatch, FriendRelation } from '@/domain/model/types';
import {
  agendaFingerprint,
  chunk,
  mergeMatches,
  normalizeAgenda,
  type AgendaMatchResult,
} from './contactsMatch';
import {
  clearContactsSync,
  isStale,
  loadContactsSync,
  onContactsSyncCleared,
  saveContactsSync,
  type ContactsSyncCache,
} from './contactsCache';

/** Igual ao limite validado pelo backend (`POST /v1/contacts/sync`). */
const BATCH_SIZE = 200;
/**
 * Com a agenda igual, a sincronização automática (ao abrir a tela) ainda volta ao servidor uma
 * vez por dia: é assim que um contato que instalou o jogo depois vira amigo sozinho, sem gastar
 * a cota diária a cada foco da tela.
 */
export const RECHECK_MS = 86_400_000;

/** O que a sincronização fez — a tela usa para o aviso discreto. */
export interface SyncOutcome {
  /** A agenda não mudou e o servidor não foi consultado. */
  skipped: boolean;
  /** Amigos novos criados automaticamente nesta sincronização. */
  connected: number;
}

export type SyncPhase = 'idle' | 'permission' | 'reading' | 'matching' | 'done' | 'error';

export interface SyncProgress {
  phase: SyncPhase;
  /** 0..1 quando dá para estimar; `null` enquanto é indeterminado. */
  ratio: number | null;
}

export type SyncErrorKind =
  | 'permission'
  | 'read'
  | 'offline'
  | 'rate_limit'
  | 'app_check'
  /** O servidor respondeu que a busca por contatos está fora do ar (ex.: diretório sem chave). */
  | 'unavailable'
  | 'unknown';

const EMPTY: AgendaMatchResult = { matched: [], unmatched: [] };

export interface UseContactsSync {
  permission: ContactsPermission;
  result: AgendaMatchResult;
  /** Sincronização já feita alguma vez (vinda do cache ou desta sessão). */
  syncedAt: number | null;
  contactCount: number;
  /** A agenda mudou (ou passou muito tempo) desde a última sincronização. */
  stale: boolean;
  syncing: boolean;
  progress: SyncProgress;
  error: SyncErrorKind | null;
  /**
   * Fluxo completo: pede permissão, lê, normaliza, compara e conecta automaticamente quem tem
   * conta. `null` quando não sincronizou (sem permissão, erro ou outra sincronização rodando).
   */
  sync: (options?: { force?: boolean }) => Promise<SyncOutcome | null>;
  /** Reavalia a permissão (ao voltar das configurações do sistema). */
  refreshPermission: () => Promise<ContactsPermission>;
  /** Atualiza a relação de um contato sem re-sincronizar (depois de adicionar/cancelar). */
  setRelation: (uid: string, relation: FriendRelation) => void;
  forget: () => Promise<void>;
}

/**
 * Orquestra a sincronização da agenda.
 *
 * Sequência: permissão -> leitura paginada -> normalização/dedupe -> lotes de 200 números ->
 * servidor (match + conexão automática) -> junção com os nomes locais -> cache.
 * Uma falha (sem rede, cota) mantém o último resultado na tela; os amigos vêm do backend
 * e não dependem da agenda. A leitura e a normalização rodam depois das animações
 * de navegação (`InteractionManager`) para a tela não engasgar ao abrir.
 */
export function useContactsSync(
  uid: string | undefined,
  /** País do usuário, para normalizar números salvos sem DDI. */
  defaultCountry: CountryCode = 'BR',
  /** Telefone do próprio usuário, para ele não aparecer como contato. */
  ownPhone?: string | null,
): UseContactsSync {
  const [permission, setPermission] = useState<ContactsPermission>('undetermined');
  const [result, setResult] = useState<AgendaMatchResult>(EMPTY);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [contactCount, setContactCount] = useState(0);
  const [stale, setStale] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress>({ phase: 'idle', ratio: null });
  const [error, setError] = useState<SyncErrorKind | null>(null);
  const fingerprint = useRef<string | null>(null);
  /** Última vez que o servidor foi consultado (desta sessão ou do cache). */
  const lastServerSync = useRef<number | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  /** Leitura do cache: a sincronização espera por ela para comparar com a última agenda. */
  const cacheLoaded = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Cache + permissão atual: a tela já abre com o último resultado, sem tocar na agenda.
  useEffect(() => {
    if (!uid) return;
    let active = true;
    cacheLoaded.current = (async () => {
      const [cached, perm] = await Promise.all([loadContactsSync(uid), getContactsPermission()]);
      if (!active) return;
      setPermission(perm);
      if (cached && perm === 'granted') {
        lastServerSync.current = cached.syncedAt;
        setResult(cached.result);
        setSyncedAt(cached.syncedAt);
        setContactCount(cached.contactCount);
        fingerprint.current = cached.fingerprint;
        setStale(isStale(cached));
      } else if (cached && (perm === 'denied' || perm === 'blocked')) {
        // Permissão revogada nas configurações: o resultado antigo não vale mais.
        // Só com uma negativa explícita: 'restricted' também é o que sobra quando a consulta
        // de permissão falha, e apagar a agenda por um erro transitório fazia os contatos sumirem.
        await clearContactsSync(uid);
      }
    })().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [uid]);

  // Apagado em Configurações: zera aqui também, senão a aba continua listando o que sumiu.
  useEffect(
    () =>
      onContactsSyncCleared((clearedUid) => {
        if (clearedUid !== uid || !mounted.current) return;
        fingerprint.current = null;
        lastServerSync.current = null;
        setResult(EMPTY);
        setSyncedAt(null);
        setContactCount(0);
        setStale(false);
        setProgress({ phase: 'idle', ratio: null });
      }),
    [uid],
  );

  // iOS avisa quando a agenda muda; aí a sincronização vira "desatualizada".
  useEffect(() => {
    if (permission !== 'granted' || !syncedAt) return;
    return subscribeContactsChanged(() => setStale(true));
  }, [permission, syncedAt]);

  const refreshPermission = useCallback(async () => {
    const perm = await getContactsPermission();
    if (mounted.current) setPermission(perm);
    return perm;
  }, []);

  const sync = useCallback(
    async (options?: { force?: boolean }): Promise<SyncOutcome | null> => {
      if (!uid || running.current) return null;
      running.current = true;
      setError(null);
      setSyncing(true);
      setProgress({ phase: 'permission', ratio: null });
      logEvent('contacts_sync_started');
      try {
        await cacheLoaded.current;
        let perm = await getContactsPermission();
        // Só pede o diálogo do sistema quando ainda dá: com 'blocked' a tela manda às configurações.
        if (perm !== 'granted' && perm !== 'blocked' && perm !== 'restricted')
          perm = await requestContactsPermission();
        if (mounted.current) setPermission(perm);
        if (perm !== 'granted') {
          logEvent('contacts_permission_denied', { state: perm });
          setError('permission');
          setProgress({ phase: 'idle', ratio: null });
          return null;
        }
        logEvent('contacts_permission_granted');

        setProgress({ phase: 'reading', ratio: null });
        // Deixa um quadro desenhar antes do trabalho pesado, senão o card de progresso só
        // aparece depois que a agenda já foi lida e a tela parece ter travado.
        await nextFrame();
        const device = await readDeviceContacts((loaded, total) => {
          if (mounted.current && total > 0)
            setProgress({ phase: 'reading', ratio: Math.min(1, loaded / total) });
        });

        const agenda = normalizeAgenda(device, defaultCountry, ownPhone ? [ownPhone] : []);
        const print = agendaFingerprint(agenda.phones);
        // `fingerprint` só existe depois de uma sincronização (desta sessão ou do cache).
        const recent =
          lastServerSync.current !== null && Date.now() - lastServerSync.current < RECHECK_MS;
        if (!options?.force && print === fingerprint.current && recent) {
          // Nada mudou na agenda e a última consulta é recente: não gasta cota nem rede à toa.
          setStale(false);
          setProgress({ phase: 'done', ratio: 1 });
          return { skipped: true, connected: 0 };
        }

        setProgress({ phase: 'matching', ratio: agenda.phones.length ? 0 : 1 });
        const batches = chunk(agenda.phones, BATCH_SIZE);
        const matches: ContactMatch[] = [];
        let connected = 0;
        let suppressed = 0;
        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i]!;
          // O servidor já cria a amizade com quem tem o telefone verificado: nada de solicitação.
          const res = await syncPhoneContacts(batch);
          connected += res.connected ?? 0;
          suppressed += res.suppressed ?? 0;
          // O servidor indexa dentro do lote; o app reposiciona no índice global da agenda.
          const offset = i * BATCH_SIZE;
          for (const m of res.matches) matches.push({ ...m, index: m.index + offset });
          if (mounted.current) setProgress({ phase: 'matching', ratio: (i + 1) / batches.length });
        }

        const merged = mergeMatches(agenda, matches);
        const cache: ContactsSyncCache = {
          syncedAt: Date.now(),
          fingerprint: print,
          contactCount: agenda.contacts.length,
          result: merged,
        };
        await saveContactsSync(uid, cache);
        lastServerSync.current = cache.syncedAt;
        const outcome: SyncOutcome = { skipped: false, connected };
        if (!mounted.current) return outcome;
        fingerprint.current = print;
        setResult(merged);
        setSyncedAt(cache.syncedAt);
        setContactCount(cache.contactCount);
        setStale(false);
        setProgress({ phase: 'done', ratio: 1 });
        // Só contagens: nenhum telefone, nome ou uid vai para o Analytics.
        logEvent('contacts_sync_completed', {
          contacts: agenda.contacts.length,
          matches: merged.matched.length,
          connected,
        });
        if (merged.matched.length > 0)
          logEvent('contact_match_found', { count: merged.matched.length });
        if (connected > 0) logEvent('auto_friend_connected', { count: connected });
        if (suppressed > 0) logEvent('auto_friend_suppressed', { count: suppressed });
        if (merged.unmatched.length > 0)
          logEvent('contact_without_account', { count: merged.unmatched.length });
        return outcome;
      } catch (e) {
        const kind = classify(e);
        if (mounted.current) {
          setError(kind);
          setProgress({ phase: 'error', ratio: null });
        }
        logEvent('contacts_sync_failed', { reason: kind });
        // Nunca registrar a agenda nem números: só o tipo do erro.
        reportError(e instanceof Error ? e : new Error('contacts_sync'), `contacts_sync_${kind}`);
        return null;
      } finally {
        running.current = false;
        if (mounted.current) setSyncing(false);
      }
    },
    [uid, defaultCountry, ownPhone],
  );

  const setRelation = useCallback(
    (targetUid: string, relation: FriendRelation) => {
      setResult((prev) => {
        if (!prev.matched.some((m) => m.uid === targetUid)) return prev;
        const next: AgendaMatchResult = {
          ...prev,
          matched: prev.matched.map((m) => (m.uid === targetUid ? { ...m, relation } : m)),
        };
        // Grava o cache para o estado sobreviver a fechar e abrir a tela.
        if (uid && fingerprint.current)
          void saveContactsSync(uid, {
            syncedAt: syncedAt ?? Date.now(),
            fingerprint: fingerprint.current,
            contactCount,
            result: next,
          });
        return next;
      });
    },
    [uid, syncedAt, contactCount],
  );

  const forget = useCallback(async () => {
    if (uid) await clearContactsSync(uid);
    if (!mounted.current) return;
    fingerprint.current = null;
    lastServerSync.current = null;
    setResult(EMPTY);
    setSyncedAt(null);
    setContactCount(0);
    setStale(false);
    setProgress({ phase: 'idle', ratio: null });
  }, [uid]);

  return {
    permission,
    result,
    syncedAt,
    contactCount,
    stale,
    syncing,
    progress,
    error,
    sync,
    refreshPermission,
    setRelation,
    forget,
  };
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function classify(e: unknown): SyncErrorKind {
  if (e instanceof ContactsReadError) return 'read';
  if (e instanceof ApiError) {
    if (e.code === 'resource-exhausted') return 'rate_limit';
    if (e.code === 'unavailable' || e.code === 'deadline-exceeded') return 'offline';
    if (e.code === 'unauthenticated') return 'app_check';
    // `failed-precondition` vem do servidor dizendo que o recurso está indisponível — não é
    // problema do aparelho. Tratar como App Check mandava o usuário caçar defeito onde não há.
    if (e.code === 'failed-precondition') return 'unavailable';
  }
  return 'unknown';
}
