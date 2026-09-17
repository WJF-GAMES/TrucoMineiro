/**
 * Configuração dinâmica do app.
 *
 * `app.json` continua sendo a base (tudo o que é estático vive lá). Este arquivo só acrescenta
 * o que depende de ambiente: os App IDs do Google Mobile Ads e a checagem do backend.
 *
 * Regra: em desenvolvimento/QA usamos o **sample app ID** oficial do Google (documentado em
 * developers.google.com/admob/{android,ios}/quick-start). Nenhum app foi criado no painel do
 * AdMob. Quando existir o App ID real, basta preenchê-lo no `.env` — ver `.env.example` e
 * `docs/ADMOB_MONETIZATION.md`.
 */

// Sample AdMob app IDs publicados pelo Google para uso durante o desenvolvimento.
const SAMPLE_ANDROID_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
const SAMPLE_IOS_APP_ID = 'ca-app-pub-3940256099942544~1458002511';

const appEnv = process.env.EXPO_PUBLIC_APP_ENV;
const isProduction = appEnv === 'production';
const isStaging = appEnv === 'staging';

/** Fora de produção o App ID é sempre o de exemplo, mesmo que o real esteja no ambiente. */
function appId(realId, sampleId) {
  if (!isProduction) return sampleId;
  const id = (realId ?? '').trim();
  return id || sampleId;
}

/**
 * Backend (NestJS): build de staging/produção sem `EXPO_PUBLIC_API_URL` https falha aqui, em vez
 * de gerar um app que aponta para lugar nenhum (ou para o backend de outro ambiente).
 */
function assertApiUrl() {
  if (!isProduction && !isStaging) return;
  if (process.env.EXPO_PUBLIC_ALLOW_INSECURE_API) {
    throw new Error('EXPO_PUBLIC_ALLOW_INSECURE_API é só para build de QA local.');
  }
  const url = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();
  if (!url.startsWith('https://')) {
    throw new Error(
      `EXPO_PUBLIC_API_URL (https) é obrigatória para builds de ${appEnv}. Configure nas variáveis do EAS.`,
    );
  }
  const local = ['localhost', '127.0.0.1', '10.0.2.2'].some((h) => url.includes(h));
  if (local || (isProduction && url.includes('staging'))) {
    throw new Error(`EXPO_PUBLIC_API_URL de ${appEnv} aponta para outro ambiente: ${url}`);
  }
}

module.exports = ({ config }) => {
  assertApiUrl();
  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      [
        'react-native-google-mobile-ads',
        {
          androidAppId: appId(process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID, SAMPLE_ANDROID_APP_ID),
          iosAppId: appId(process.env.EXPO_PUBLIC_ADMOB_IOS_APP_ID, SAMPLE_IOS_APP_ID),
          // Inicialização e carregamento otimizados: o SDK não bloqueia a thread no startup.
          optimizeInitialization: true,
          optimizeAdLoading: true,
          // O App Measurement só sobe depois do consentimento resolvido.
          delayAppMeasurementInit: true,
          userTrackingUsageDescription:
            'Usamos esta permissão apenas para exibir anúncios mais relevantes. Recusar não muda nada no jogo.',
        },
      ],
    ],
  };
};
