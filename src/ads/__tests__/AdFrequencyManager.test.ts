import { AD_CONFIG_DEFAULTS } from '../config/adConfig';
import {
  canShowRewarded,
  dateKeyOf,
  emptySnapshot,
  registerFullScreenShown,
  registerInterstitialShown,
  registerMatchCompleted,
  rollDaily,
  sessionInterstitialAllowance,
  shouldShowAppOpen,
  shouldShowInterstitial,
  startSession,
} from '../core/AdFrequencyManager';
import type { AdConfig, AdRuntimeGuards, FrequencySnapshot } from '../types/ads.types';

const NOW = new Date('2026-03-10T15:00:00').getTime();
const MINUTE = 60_000;

const config: AdConfig = AD_CONFIG_DEFAULTS;

const openGuards: AdRuntimeGuards = {
  adsEnabled: true,
  canRequestAds: true,
  isGameActive: false,
  isMatchmakingActive: false,
  isFullScreenAdShowing: false,
  isCriticalModalOpen: false,
  isAppActive: true,
  isNavigationStable: true,
  isAdFreeScreen: false,
};

/** Sessão madura (3ª), fora do período de aquecimento, com o anúncio já carregado. */
function matureSnapshot(patch: Partial<FrequencySnapshot> = {}): FrequencySnapshot {
  return {
    ...emptySnapshot(NOW),
    sessionNumber: 3,
    sessionStartedAt: NOW - 10 * MINUTE,
    matchesCompleted: 5,
    sessionMatchesCompleted: 3,
    matchesSinceLastInterstitial: 3,
    ...patch,
  };
}

function decide(
  snapshot: FrequencySnapshot,
  overrides: {
    guards?: Partial<AdRuntimeGuards>;
    config?: Partial<AdConfig>;
    adLoaded?: boolean;
    used?: boolean;
    now?: number;
  } = {},
) {
  return shouldShowInterstitial({
    now: overrides.now ?? NOW,
    config: { ...config, ...overrides.config },
    snapshot,
    guards: { ...openGuards, ...overrides.guards },
    adLoaded: overrides.adLoaded ?? true,
    fullScreenUsedForCurrentResult: overrides.used ?? false,
  });
}

describe('sessões iniciais', () => {
  it('não mostra nenhum interstitial na primeira sessão', () => {
    expect(sessionInterstitialAllowance(1, config)).toBe(0);
    const snapshot = matureSnapshot({ sessionNumber: 1, matchesCompleted: 9 });
    expect(decide(snapshot)).toEqual({ show: false, reason: 'first_session' });
  });

  it('permite no máximo um interstitial na segunda sessão', () => {
    expect(sessionInterstitialAllowance(2, config)).toBe(1);
    const first = matureSnapshot({ sessionNumber: 2 });
    expect(decide(first)).toEqual({ show: true });

    const after = registerInterstitialShown(first, NOW);
    const second = { ...after, matchesSinceLastInterstitial: 3, lastFullScreenAdAt: null };
    expect(decide(second, { now: NOW + 60 * MINUTE })).toEqual({
      show: false,
      reason: 'session_cap',
    });
  });

  it('da terceira sessão em diante vale o cap configurado', () => {
    expect(sessionInterstitialAllowance(3, config)).toBe(config.interstitialMaxPerSession);
  });
});

describe('cadência por partidas', () => {
  it('bloqueia antes do mínimo de partidas para o primeiro anúncio', () => {
    const snapshot = matureSnapshot({ matchesCompleted: 1, matchesSinceLastInterstitial: 1 });
    expect(decide(snapshot)).toEqual({ show: false, reason: 'not_enough_matches' });
  });

  it('libera o primeiro anúncio ao atingir o mínimo de partidas', () => {
    const snapshot = matureSnapshot({ matchesCompleted: 2, matchesSinceLastInterstitial: 2 });
    expect(decide(snapshot)).toEqual({ show: true });
  });

  it('depois do primeiro, exige N partidas desde o último', () => {
    const shown = registerInterstitialShown(matureSnapshot(), NOW);
    const onlyTwo = registerMatchCompleted(registerMatchCompleted(shown));
    expect(decide(onlyTwo, { now: NOW + 60 * MINUTE })).toEqual({
      show: false,
      reason: 'cadence',
    });

    const three = registerMatchCompleted(onlyTwo);
    expect(decide(three, { now: NOW + 60 * MINUTE })).toEqual({ show: true });
  });

  it('zera a contagem de partidas ao exibir', () => {
    const shown = registerInterstitialShown(matureSnapshot(), NOW);
    expect(shown.matchesSinceLastInterstitial).toBe(0);
    expect(shown.sessionInterstitialCount).toBe(1);
    expect(shown.dailyInterstitialCount).toBe(1);
  });
});

describe('cooldowns', () => {
  it('bloqueia dentro do cooldown de interstitial', () => {
    const shown = registerInterstitialShown(matureSnapshot(), NOW);
    const withMatches = { ...shown, matchesSinceLastInterstitial: 3 };
    expect(decide(withMatches, { now: NOW + 60_000 })).toEqual({ show: false, reason: 'cooldown' });
  });

  it('libera depois do cooldown', () => {
    const shown = registerInterstitialShown(matureSnapshot(), NOW);
    const withMatches = { ...shown, matchesSinceLastInterstitial: 3 };
    const later = NOW + (config.fullScreenGlobalCooldownSeconds + 1) * 1000;
    expect(decide(withMatches, { now: later })).toEqual({ show: true });
  });

  it('o cooldown global segura o interstitial depois de um rewarded', () => {
    const snapshot = registerFullScreenShown(matureSnapshot(), NOW - 30_000);
    expect(decide(snapshot)).toEqual({ show: false, reason: 'global_cooldown' });
  });
});

describe('caps', () => {
  it('respeita o cap diário', () => {
    const snapshot = matureSnapshot({
      dailyInterstitialCount: config.interstitialMaxPerDay,
      lastInterstitialAt: NOW - 60 * MINUTE,
      lastFullScreenAdAt: NOW - 60 * MINUTE,
    });
    expect(decide(snapshot)).toEqual({ show: false, reason: 'daily_cap' });
  });

  it('zera o cap diário na virada do dia', () => {
    const snapshot = matureSnapshot({ dailyInterstitialCount: 8, dateKey: '2026-03-09' });
    const rolled = rollDaily(snapshot, NOW);
    expect(rolled.dateKey).toBe(dateKeyOf(NOW));
    expect(rolled.dailyInterstitialCount).toBe(0);
  });

  it('respeita o cap de sessão', () => {
    const snapshot = matureSnapshot({
      sessionInterstitialCount: config.interstitialMaxPerSession,
      lastInterstitialAt: NOW - 60 * MINUTE,
      lastFullScreenAdAt: NOW - 60 * MINUTE,
    });
    expect(decide(snapshot)).toEqual({ show: false, reason: 'session_cap' });
  });
});

describe('sessão jovem', () => {
  it('não mostra anúncio nos primeiros minutos da sessão', () => {
    const snapshot = matureSnapshot({ sessionStartedAt: NOW - 30_000 });
    expect(decide(snapshot)).toEqual({ show: false, reason: 'session_too_young' });
  });
});

describe('guardas de gameplay', () => {
  it('nunca mostra durante a partida', () => {
    expect(decide(matureSnapshot(), { guards: { isGameActive: true } })).toEqual({
      show: false,
      reason: 'game_active',
    });
  });

  it('nunca mostra durante o matchmaking', () => {
    expect(decide(matureSnapshot(), { guards: { isMatchmakingActive: true } })).toEqual({
      show: false,
      reason: 'matchmaking_active',
    });
  });

  it('nunca mostra com o app em background', () => {
    expect(decide(matureSnapshot(), { guards: { isAppActive: false } })).toEqual({
      show: false,
      reason: 'app_background',
    });
  });

  it('nunca mostra com modal crítico aberto ou navegação instável', () => {
    expect(decide(matureSnapshot(), { guards: { isCriticalModalOpen: true } })).toEqual({
      show: false,
      reason: 'modal_open',
    });
    expect(decide(matureSnapshot(), { guards: { isAdFreeScreen: true } })).toEqual({
      show: false,
      reason: 'ad_free_screen',
    });
    expect(decide(matureSnapshot(), { guards: { isNavigationStable: false } })).toEqual({
      show: false,
      reason: 'navigation_unstable',
    });
  });

  it('nunca mostra dois full-screen ao mesmo tempo', () => {
    expect(decide(matureSnapshot(), { guards: { isFullScreenAdShowing: true } })).toEqual({
      show: false,
      reason: 'full_screen_showing',
    });
  });
});

describe('kill switch e consentimento', () => {
  it('ads_enabled=false desliga o interstitial', () => {
    expect(decide(matureSnapshot(), { config: { adsEnabled: false } })).toEqual({
      show: false,
      reason: 'ads_disabled',
    });
  });

  it('interstitial_enabled=false desliga só o formato', () => {
    expect(decide(matureSnapshot(), { config: { interstitialEnabled: false } })).toEqual({
      show: false,
      reason: 'interstitial_disabled',
    });
  });

  it('sem consentimento não há anúncio', () => {
    expect(decide(matureSnapshot(), { guards: { canRequestAds: false } })).toEqual({
      show: false,
      reason: 'consent_missing',
    });
  });
});

describe('rewarded e interstitial no mesmo resultado', () => {
  it('quem assistiu ao rewarded não leva interstitial da mesma partida', () => {
    expect(decide(matureSnapshot(), { used: true })).toEqual({
      show: false,
      reason: 'result_already_used_full_screen',
    });
  });
});

describe('anúncio não carregado', () => {
  it('pula em vez de esperar', () => {
    expect(decide(matureSnapshot(), { adLoaded: false })).toEqual({
      show: false,
      reason: 'not_loaded',
    });
  });
});

describe('rewarded', () => {
  it('é liberado quando nada de gameplay está acontecendo', () => {
    expect(canShowRewarded(config, openGuards)).toEqual({ show: true });
  });

  it('é bloqueado durante a partida', () => {
    expect(canShowRewarded(config, { ...openGuards, isGameActive: true })).toEqual({
      show: false,
      reason: 'game_active',
    });
  });

  it('segue o kill switch geral', () => {
    expect(canShowRewarded({ ...config, adsEnabled: false }, openGuards)).toEqual({
      show: false,
      reason: 'ads_disabled',
    });
  });
});

describe('app open', () => {
  const base = {
    now: NOW,
    guards: openGuards,
    adLoaded: true,
    snapshot: matureSnapshot({ sessionNumber: 6, lastFullScreenAdAt: null }),
  };

  it('fica desligado por padrão', () => {
    expect(shouldShowAppOpen({ ...base, config, backgroundSeconds: 7 * 3600 })).toEqual({
      show: false,
      reason: 'interstitial_disabled',
    });
  });

  it('quando ligado, ignora a volta rápida do usuário', () => {
    const on = { ...config, appOpenEnabled: true };
    expect(shouldShowAppOpen({ ...base, config: on, backgroundSeconds: 30 })).toEqual({
      show: false,
      reason: 'cadence',
    });
  });

  it('quando ligado, nunca aparece ao voltar para o login ou para a tela do código', () => {
    const on = { ...config, appOpenEnabled: true };
    expect(
      shouldShowAppOpen({
        ...base,
        config: on,
        backgroundSeconds: 7 * 3600,
        guards: { ...openGuards, isAdFreeScreen: true },
      }),
    ).toEqual({ show: false, reason: 'ad_free_screen' });
  });

  it('quando ligado, aparece para usuário maduro após background longo', () => {
    const on = { ...config, appOpenEnabled: true };
    expect(shouldShowAppOpen({ ...base, config: on, backgroundSeconds: 7 * 3600 })).toEqual({
      show: true,
    });
  });

  it('quando ligado, ainda respeita a partida em andamento', () => {
    const on = { ...config, appOpenEnabled: true };
    expect(
      shouldShowAppOpen({
        ...base,
        config: on,
        guards: { ...openGuards, isGameActive: true },
        backgroundSeconds: 7 * 3600,
      }),
    ).toEqual({ show: false, reason: 'game_active' });
  });
});

describe('ciclo de sessões', () => {
  it('startSession incrementa a sessão e zera os contadores dela', () => {
    const first = registerInterstitialShown(matureSnapshot(), NOW);
    const next = startSession(first, NOW + 3 * 3600_000);
    expect(next.sessionNumber).toBe(first.sessionNumber + 1);
    expect(next.sessionInterstitialCount).toBe(0);
    expect(next.sessionMatchesCompleted).toBe(0);
    // O cap diário e a maturidade do usuário sobrevivem à nova sessão.
    expect(next.dailyInterstitialCount).toBe(first.dailyInterstitialCount);
    expect(next.matchesCompleted).toBe(first.matchesCompleted);
  });
});
