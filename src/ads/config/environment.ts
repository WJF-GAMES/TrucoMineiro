import type { AdEnvironment } from '../types/ads.types';

/**
 * Ambiente de anúncios.
 *
 * Regra inegociável (item 8 do plano de monetização): `development` e `staging` NUNCA usam
 * IDs reais, mesmo que as variáveis de produção existam por engano no `.env`. A decisão mora
 * aqui, num único lugar, e `adUnits.ts` é o único consumidor.
 */
export function resolveEnvironment(): AdEnvironment {
  if (__DEV__) return 'development';
  // `process.env.EXPO_PUBLIC_*` é substituído literalmente pelo bundler — não pode ser dinâmico.
  return process.env.EXPO_PUBLIC_APP_ENV === 'staging' ? 'staging' : 'production';
}

export const adEnvironment: AdEnvironment = resolveEnvironment();

/** Só produção pode usar IDs reais; todo o resto é obrigatoriamente Test Ad. */
export const isProductionAdEnvironment = adEnvironment === 'production';

/** Verdadeiro sempre que o app estiver servindo anúncios oficiais de teste do Google. */
export const usingTestAds = !isProductionAdEnvironment;
