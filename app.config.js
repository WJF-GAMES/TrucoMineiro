/**
 * Configuração dinâmica do app.
 *
 * `app.json` continua sendo a base (tudo o que é estático vive lá). Este arquivo só acrescenta
 * o que depende de ambiente: os App IDs do Google Mobile Ads.
 *
 * Regra: em desenvolvimento/QA usamos o **sample app ID** oficial do Google (documentado em
 * developers.google.com/admob/{android,ios}/quick-start). Nenhum app foi criado no painel do
 * AdMob. Quando existir o App ID real, basta preenchê-lo no `.env` — ver `.env.example` e
 * `docs/ADMOB_MONETIZATION.md`.
 */

// Sample AdMob app IDs publicados pelo Google para uso durante o desenvolvimento.
const SAMPLE_ANDROID_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
const SAMPLE_IOS_APP_ID = 'ca-app-pub-3940256099942544~1458002511';

const isProduction = process.env.EXPO_PUBLIC_APP_ENV === 'production';

/** Fora de produção o App ID é sempre o de exemplo, mesmo que o real esteja no ambiente. */
function appId(realId, sampleId) {
  if (!isProduction) return sampleId;
  const id = (realId ?? '').trim();
  return id || sampleId;
}

module.exports = ({ config }) => ({
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
});
