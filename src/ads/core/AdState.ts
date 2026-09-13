import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type {
  AdEnvironment,
  AdPlacement,
  AdRuntimeGuards,
  FrequencySnapshot,
  RewardedPlacement,
} from '../types/ads.types';
import { adEnvironment, usingTestAds } from '../config/environment';
import { emptySnapshot, rollDaily, startSession } from './AdFrequencyManager';

const STORAGE_KEY = 'trucox.ads.v1';

/** Só o que precisa sobreviver ao fechamento do app (cap diário, maturidade do usuário). */
interface PersistedState {
  dateKey: string;
  dailyInterstitialCount: number;
  sessionNumber: number;
  matchesCompleted: number;
  matchesSinceLastInterstitial: number;
  lastInterstitialAt: number | null;
  lastFullScreenAdAt: number | null;
}

interface AdStore {
  // --- Ambiente ---------------------------------------------------------------
  environment: AdEnvironment;
  usingTestAds: boolean;
  initialized: boolean;
  hydrated: boolean;

  // --- Consentimento ----------------------------------------------------------
  canRequestAds: boolean;
  consentStatus: string;
  privacyOptionsRequired: boolean;

  // --- Guardas de runtime -----------------------------------------------------
  adsEnabled: boolean;
  isGameActive: boolean;
  isMatchmakingActive: boolean;
  isFullScreenAdShowing: boolean;
  criticalModalCount: number;
  isAppActive: boolean;
  isNavigationStable: boolean;

  /** Um full-screen já foi consumido para o resultado de partida atual. */
  fullScreenUsedForCurrentResult: boolean;

  // --- Estado dos anúncios ----------------------------------------------------
  interstitialLoaded: boolean;
  appOpenLoaded: boolean;
  rewardedLoaded: Record<RewardedPlacement, boolean>;
  /** Último motivo de bloqueio por placement — alimenta o painel de debug. */
  lastSkipReason: Partial<Record<AdPlacement, string>>;

  frequency: FrequencySnapshot;

  // --- Ações ------------------------------------------------------------------
  hydrate: () => Promise<void>;
  beginSession: (now: number) => void;
  setInitialized: (v: boolean) => void;
  setConsent: (v: {
    canRequestAds: boolean;
    status: string;
    privacyOptionsRequired: boolean;
  }) => void;
  setAdsEnabled: (v: boolean) => void;
  setGameActive: (v: boolean) => void;
  setMatchmakingActive: (v: boolean) => void;
  setFullScreenShowing: (v: boolean) => void;
  pushCriticalModal: () => void;
  popCriticalModal: () => void;
  setAppActive: (v: boolean) => void;
  setNavigationStable: (v: boolean) => void;
  setResultFullScreenUsed: (v: boolean) => void;
  setInterstitialLoaded: (v: boolean) => void;
  setAppOpenLoaded: (v: boolean) => void;
  setRewardedLoaded: (placement: RewardedPlacement, v: boolean) => void;
  setSkipReason: (placement: AdPlacement, reason: string | null) => void;
  updateFrequency: (fn: (snapshot: FrequencySnapshot) => FrequencySnapshot) => void;
}

export const useAdStore = create<AdStore>((set, get) => ({
  environment: adEnvironment,
  usingTestAds,
  initialized: false,
  hydrated: false,

  canRequestAds: false,
  consentStatus: 'UNKNOWN',
  privacyOptionsRequired: false,

  adsEnabled: true,
  isGameActive: false,
  isMatchmakingActive: false,
  isFullScreenAdShowing: false,
  criticalModalCount: 0,
  isAppActive: true,
  isNavigationStable: true,

  fullScreenUsedForCurrentResult: false,

  interstitialLoaded: false,
  appOpenLoaded: false,
  rewardedLoaded: { match_analysis_rewarded: false, home_tip_rewarded: false },
  lastSkipReason: {},

  frequency: emptySnapshot(Date.now()),

  hydrate: async () => {
    if (get().hydrated) return;
    const now = Date.now();
    let persisted: PersistedState | null = null;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) persisted = JSON.parse(raw) as PersistedState;
    } catch {
      // Storage corrompido ou indisponível: o usuário simplesmente recomeça como novo.
    }
    const base = emptySnapshot(now);
    const snapshot: FrequencySnapshot = persisted
      ? rollDaily(
          {
            ...base,
            dateKey: persisted.dateKey ?? base.dateKey,
            dailyInterstitialCount: persisted.dailyInterstitialCount ?? 0,
            // `sessionNumber` guardado é o da sessão anterior; `beginSession` incrementa.
            sessionNumber: persisted.sessionNumber ?? 0,
            matchesCompleted: persisted.matchesCompleted ?? 0,
            matchesSinceLastInterstitial: persisted.matchesSinceLastInterstitial ?? 0,
            lastInterstitialAt: persisted.lastInterstitialAt ?? null,
            lastFullScreenAdAt: persisted.lastFullScreenAdAt ?? null,
          },
          now,
        )
      : { ...base, sessionNumber: 0 };
    set({ frequency: snapshot, hydrated: true });
  },

  beginSession: (now) => {
    set({ frequency: startSession(get().frequency, now) });
    void persist(get().frequency);
  },

  setInitialized: (v) => set({ initialized: v }),
  setConsent: (v) =>
    set({
      canRequestAds: v.canRequestAds,
      consentStatus: v.status,
      privacyOptionsRequired: v.privacyOptionsRequired,
    }),
  setAdsEnabled: (v) => set({ adsEnabled: v }),
  setGameActive: (v) => set({ isGameActive: v }),
  setMatchmakingActive: (v) => set({ isMatchmakingActive: v }),
  setFullScreenShowing: (v) => set({ isFullScreenAdShowing: v }),
  pushCriticalModal: () => set((s) => ({ criticalModalCount: s.criticalModalCount + 1 })),
  popCriticalModal: () =>
    set((s) => ({ criticalModalCount: Math.max(0, s.criticalModalCount - 1) })),
  setAppActive: (v) => set({ isAppActive: v }),
  setNavigationStable: (v) => set({ isNavigationStable: v }),
  setResultFullScreenUsed: (v) => set({ fullScreenUsedForCurrentResult: v }),
  setInterstitialLoaded: (v) => set({ interstitialLoaded: v }),
  setAppOpenLoaded: (v) => set({ appOpenLoaded: v }),
  setRewardedLoaded: (placement, v) =>
    set((s) => ({ rewardedLoaded: { ...s.rewardedLoaded, [placement]: v } })),
  setSkipReason: (placement, reason) =>
    set((s) => ({ lastSkipReason: { ...s.lastSkipReason, [placement]: reason ?? undefined } })),

  updateFrequency: (fn) => {
    const next = fn(get().frequency);
    set({ frequency: next });
    void persist(next);
  },
}));

async function persist(snapshot: FrequencySnapshot) {
  const payload: PersistedState = {
    dateKey: snapshot.dateKey,
    dailyInterstitialCount: snapshot.dailyInterstitialCount,
    sessionNumber: snapshot.sessionNumber,
    matchesCompleted: snapshot.matchesCompleted,
    matchesSinceLastInterstitial: snapshot.matchesSinceLastInterstitial,
    lastInterstitialAt: snapshot.lastInterstitialAt,
    lastFullScreenAdAt: snapshot.lastFullScreenAdAt,
  };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Persistência é best-effort: perder o cap diário não pode quebrar o app.
  }
}

/** Guardas de runtime no formato que o `AdFrequencyManager` consome. */
export function currentGuards(): AdRuntimeGuards {
  const s = useAdStore.getState();
  return {
    adsEnabled: s.adsEnabled,
    canRequestAds: s.canRequestAds,
    isGameActive: s.isGameActive,
    isMatchmakingActive: s.isMatchmakingActive,
    isFullScreenAdShowing: s.isFullScreenAdShowing,
    isCriticalModalOpen: s.criticalModalCount > 0,
    isAppActive: s.isAppActive,
    isNavigationStable: s.isNavigationStable,
  };
}

export const AD_STORAGE_KEY = STORAGE_KEY;
