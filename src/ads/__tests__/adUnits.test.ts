/* eslint-disable @typescript-eslint/no-require-imports --
 * `jest.isolateModules` precisa recarregar os módulos de configuração em runtime, o que só
 * `require` permite: um `import` estático seria avaliado uma vez só, com o ambiente errado.
 */
/**
 * Protege a regra mais importante da configuração: desenvolvimento e staging **nunca** podem
 * servir um ID real, e produção sem ID configurado tem de ficar sem anúncio (jamais Test Ads
 * num app publicado).
 */

const TEST_ID_PREFIX = 'ca-app-pub-3940256099942544/';
const FAKE_PROD_ID = 'ca-app-pub-0000000000000000/1111111111';

type AdUnitsModule = typeof import('../config/adUnits');
type EnvModule = typeof import('../config/environment');

/** Recarrega os módulos de configuração com um ambiente controlado. */
function loadWith(env: Record<string, string | undefined>, dev: boolean) {
  let units!: AdUnitsModule;
  let environment!: EnvModule;
  const previousDev = (global as unknown as { __DEV__: boolean }).__DEV__;
  const previousEnv = { ...process.env };

  (global as unknown as { __DEV__: boolean }).__DEV__ = dev;
  Object.assign(process.env, env);

  jest.isolateModules(() => {
    environment = require('../config/environment');
    units = require('../config/adUnits');
  });

  (global as unknown as { __DEV__: boolean }).__DEV__ = previousDev;
  process.env = previousEnv;
  return { units, environment };
}

describe('development', () => {
  it('usa Test IDs oficiais mesmo com IDs de produção no ambiente', () => {
    const { units, environment } = loadWith(
      {
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_MATCH_RESULT: FAKE_PROD_ID,
        EXPO_PUBLIC_ADMOB_ANDROID_NATIVE_HOME: FAKE_PROD_ID,
      },
      true,
    );

    expect(environment.adEnvironment).toBe('development');
    expect(environment.usingTestAds).toBe(true);
    expect(units.adUnitFor('match_result_interstitial')).toContain(TEST_ID_PREFIX);
    expect(units.adUnitFor('home_native_primary')).toContain(TEST_ID_PREFIX);
  });
});

describe('staging', () => {
  it('também é obrigatoriamente Test Ads', () => {
    const { units, environment } = loadWith(
      {
        EXPO_PUBLIC_APP_ENV: 'staging',
        EXPO_PUBLIC_ADMOB_ANDROID_REWARDED_MATCH_ANALYSIS: FAKE_PROD_ID,
      },
      false,
    );

    expect(environment.adEnvironment).toBe('staging');
    expect(environment.usingTestAds).toBe(true);
    expect(units.adUnitFor('match_analysis_rewarded')).toContain(TEST_ID_PREFIX);
  });
});

describe('production', () => {
  it('sem IDs configurados, o placement fica sem unit (anúncio desativado)', () => {
    const { units, environment } = loadWith(
      {
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_MATCH_RESULT: '',
        EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_MATCH_RESULT: '',
        EXPO_PUBLIC_ADMOB_ANDROID_NATIVE_HOME: undefined,
        EXPO_PUBLIC_ADMOB_IOS_NATIVE_HOME: undefined,
      },
      false,
    );

    expect(environment.usingTestAds).toBe(false);
    expect(units.adUnitFor('match_result_interstitial')).toBeNull();
    expect(units.hasAdUnit('home_native_primary')).toBe(false);
  });

  it('usa o ID configurado quando ele existe', () => {
    const { units } = loadWith(
      {
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_MATCH_RESULT: FAKE_PROD_ID,
        EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_MATCH_RESULT: FAKE_PROD_ID,
      },
      false,
    );

    expect(units.adUnitFor('match_result_interstitial')).toBe(FAKE_PROD_ID);
  });
});

describe('mapa de placements', () => {
  it('todo placement tem formato e tela declarados', () => {
    const { units } = loadWith({ EXPO_PUBLIC_APP_ENV: 'staging' }, true);
    for (const placement of Object.keys(units.PLACEMENT_FORMAT) as (keyof typeof units.PLACEMENT_FORMAT)[]) {
      expect(units.PLACEMENT_FORMAT[placement]).toBeTruthy();
      expect(units.PLACEMENT_SCREEN[placement]).toBeTruthy();
    }
  });
});
