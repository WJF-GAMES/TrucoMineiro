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
import { FunctionsError, matchPhoneContacts } from '@/services/firebase/functions';
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

/** Igual ao limite validado pela Cloud Function (`MATCH_BATCH_LIMIT`). */
const BATCH_SIZE = 200;

export type SyncPhase = 'idle' | 'permission' | 'reading' | 'matching' | 'done' | 'error';

export interface SyncProgress {
  phase: SyncPhase;
  /** 0..1 quando dá para estimar; `null` enquanto é indeterminado. */
  ratio: number | null;
}

export type SyncErrorKind =
  'permission' | 'read' | 'offline' | 'rate_limit' | 'app_check' | 'unknown';

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
  /** Fluxo completo: explica, pede permissão, lê, normaliza e compara. */
  sync: (options?: { force?: boolean }) => Promise<void>;
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
 * junção com os nomes locais -> cache. A leitura e a normalização rodam depois das animações
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
  const running = useRef(false);
  const mounted = useRef(true);

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
    (async () => {
      const [cached, perm] = await Promise.all([loadContactsSync(uid), getContactsPermission()]);
      if (!active) return;
      setPermission(perm);
      if (cached && perm === 'granted') {
        setResult(cached.result);
        setSyncedAt(cached.syncedAt);
        setContactCount(cached.contactCount);
        fingerprint.current = cached.fingerprint;
        setStale(isStale(cached));
      } else if (cached && perm !== 'granted') {
        // Permissão revogada nas configurações: o resultado antigo não vale mais.
        await clearContactsSync(uid);
      }
    })();
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
    async (options?: { force?: boolean }) => {
      if (!uid || running.current) return;
      running.current = true;
      setError(null);
      setSyncing(true);
      setProgress({ phase: 'permission', ratio: null });
      logEvent('contacts_sync_started');
      try {
        let perm = await getContactsPermission();
        // Só pede o diálogo do sistema quando ainda dá: com 'blocked' a tela manda às configurações.
        if (perm !== 'granted' && perm !== 'blocked' && perm !== 'restricted')
          perm = await requestContactsPermission();
        if (mounted.current) setPermission(perm);
        if (perm !== 'granted') {
          logEvent('contacts_permission_denied', { state: perm });
          setError('permission');
          setProgress({ phase: 'idle', ratio: null });
          return;
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
        if (!options?.force && print === fingerprint.current && syncedAt) {
          // Nada mudou na agenda: não gasta cota nem rede à toa.
          setStale(false);
          setProgress({ phase: 'done', ratio: 1 });
          return;
        }

        setProgress({ phase: 'matching', ratio: agenda.phones.length ? 0 : 1 });
        const batches = chunk(agenda.phones, BATCH_SIZE);
        const matches: ContactMatch[] = [];
        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i]!;
          const res = await matchPhoneContacts(batch);
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
        if (!mounted.current) return;
        fingerprint.current = print;
        setResult(merged);
        setSyncedAt(cache.syncedAt);
        setContactCount(cache.contactCount);
        setStale(false);
        setProgress({ phase: 'done', ratio: 1 });
        logEvent('contacts_sync_completed', {
          contacts: agenda.contacts.length,
          matches: merged.matched.length,
        });
        if (merged.matched.length > 0)
          logEvent('contact_match_found', { count: merged.matched.length });
      } catch (e) {
        const kind = classify(e);
        if (mounted.current) {
          setError(kind);
          setProgress({ phase: 'error', ratio: null });
        }
        logEvent('contacts_sync_failed', { reason: kind });
        // Nunca registrar a agenda nem números: só o tipo do erro.
        reportError(e instanceof Error ? e : new Error('contacts_sync'), `contacts_sync_${kind}`);
      } finally {
        running.current = false;
        if (mounted.current) setSyncing(false);
      }
    },
    [uid, defaultCountry, ownPhone, syncedAt],
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
  if (e instanceof FunctionsError) {
    if (e.code === 'resource-exhausted') return 'rate_limit';
    if (e.code === 'unavailable' || e.code === 'deadline-exceeded') return 'offline';
    if (e.code === 'unauthenticated' || e.code === 'failed-precondition') return 'app_check';
  }
  return 'unknown';
}
