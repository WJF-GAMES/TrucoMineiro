# Monetização por anúncios (Google Mobile Ads / AdMob)

O Truco Mineiro é monetizado **exclusivamente por publicidade**. Não existem moedas virtuais,
gemas, loja, compras no app nem qualquer vantagem competitiva paga.

A meta não é o maior número de impressões — é a **receita sustentável por usuário ao longo do
tempo**. Uma impressão que faz o usuário abandonar o app vale menos que dezenas de impressões
futuras, então UX, retenção e receita são decididas juntas.

> **Status atual: somente Test Ads.** Nenhum app foi criado no AdMob, nenhuma unidade real
> existe e nenhum painel externo foi acessado. Ver [Checklist para produção](#checklist-para-produção).

---

## 1. Stack

| Item | Valor |
| --- | --- |
| SDK | `react-native-google-mobile-ads` 16.2.3 (pinado — ver nota abaixo) |
| Plataforma | Expo 57 (dev-client) + React Native 0.86, New Architecture |
| Config nativa | `app.config.js` (plugin do SDK sobre o `app.json`) |
| Configuração de negócio | Firebase Remote Config (já existente no app) |
| Telemetria | Firebase Analytics (já existente no app) |

> **Por que a versão está pinada em 16.2.3.** A 16.4/16.5 trazem
> `com.google.android.gms:play-services-ads:25.4.0`, cujos metadados Kotlin são da versão 2.3.0.
> O projeto compila Kotlin 2.1 (padrão do Expo 57), então o módulo nativo do SDK não compila:
> *"Module was compiled with an incompatible version of Kotlin"*. A 16.2.3 usa
> `play-services-ads:25.0.0` e compila sem tocar no toolchain do app.
> Para subir de versão, primeiro é preciso elevar o `kotlinVersion` do projeto (via
> `expo-build-properties`) e revalidar **todos** os módulos nativos.

---

## 2. Arquitetura

Tudo vive em `src/ads/`. **Nenhuma tela conversa com o SDK**: as telas falam com o `AdService`
e com os hooks, sempre através de um *placement* nomeado.

```
src/ads/
  config/
    environment.ts          ambiente (development | staging | production)
    adUnits.ts              placement -> Ad Unit (Test IDs vs. produção)
    adConfig.ts             defaults locais + fonte plugável de configuração
    remoteAdConfigSource.ts ligação com o Remote Config
  core/
    AdService.ts            fachada única (decide, exibe, observa)
    AdState.ts              store (zustand) de guardas, contadores e persistência
    AdFrequencyManager.ts   política de frequência — puro e 100% testado
    AdPlacementManager.ts   placements nomeados e se estão ligados
    AdAudioBridge.ts        pausa/retoma áudio e reflete a preferência de som
    backoff.ts              retentativa com backoff exponencial
  managers/
    InterstitialManager.ts  fim de partida
    RewardedManager.ts      análise da partida e dica da Principal
    NativeAdManager.ts      cards nativos
    AppOpenManager.ts       infraestrutura pronta, formato DESLIGADO
  privacy/
    ConsentManager.ts       Google UMP
    TrackingManager.ts      ATT do iOS (provider plugável — ver pendências)
  analytics/
    AdAnalytics.ts          eventos carimbados com format/placement/screen
  components/
    NativeAdCard.tsx        card nativo identificado como patrocinado
    SponsoredContentCard.tsx "Dica de Truco" (rewarded opcional da Principal)
    SponsoredBadge.tsx      rótulo obrigatório de anúncio
    RewardedGate.tsx        confirmação explícita antes de qualquer rewarded
    AdsDebugPanel.tsx       diagnóstico — só em desenvolvimento
  hooks/
    useAds.ts               estado geral + guardas de gameplay/matchmaking
    useRewardedAd.ts        fluxo opt-in de rewarded
    useNativeAd.ts          carga e ciclo de vida de um native ad
  content/
    trucoTips.ts            conteúdo liberado pelo rewarded da Principal
  types/ads.types.ts
```

### Fluxo de inicialização

```
boot do app (fontes, App Check, Remote Config, auth)
        ↓  (só depois — monetização nunca atrasa o startup)
AdService.initialize()
        ↓
hidrata contadores (AsyncStorage) → abre nova sessão
        ↓
kill switch ligado? → não requisita nada
        ↓
ConsentManager.initialize()  (UMP)
        ↓
mobileAds().setRequestConfiguration() + initialize()
        ↓
preload escalonado: interstitial → (1,5s) rewarded dica → (4s) app open
```

---

## 3. Test Ads e proteção de ambiente

`src/ads/config/environment.ts` resolve o ambiente e `adUnits.ts` é o **único** lugar que
transforma placement em Ad Unit:

| Ambiente | Origem do ID |
| --- | --- |
| `development` (`__DEV__`) | constantes `TestIds` do SDK |
| `staging` (`EXPO_PUBLIC_APP_ENV=staging`) | constantes `TestIds` do SDK |
| `production` | `process.env.EXPO_PUBLIC_ADMOB_*` |

Regras que os testes (`src/ads/__tests__/adUnits.test.ts`) trancam:

- development e staging usam Test Ads **mesmo que** os IDs de produção existam no ambiente;
- produção **sem** ID configurado devolve `null` → o placement fica desligado. Um app publicado
  nunca cai para Test Ads, porque isso geraria tráfego inválido.

Os App IDs nativos (AndroidManifest / Info.plist) saem de `app.config.js`. Fora de produção
usa-se o **sample app ID** oficial do Google:

- Android `ca-app-pub-3940256099942544~3347511713`
- iOS `ca-app-pub-3940256099942544~1458002511`

---

## 4. Placements

| Placement | Formato | Tela | Padrão |
| --- | --- | --- | --- |
| `home_native_primary` | native | Principal | ligado |
| `league_native_footer` | native | Liga | ligado |
| `friends_native_footer` | native | Amigos | ligado |
| `profile_native` | native | Perfil | **desligado** |
| `match_result_interstitial` | interstitial | Resultado | ligado |
| `match_analysis_rewarded` | rewarded | Resultado | ligado |
| `home_tip_rewarded` | rewarded | Principal | ligado |
| `app_open` | app open | App | **desligado** |

Telas **sem nenhum anúncio**: Introdução, Login, OTP, Cadastro, Partida, Matchmaking, Sala,
Entrar em sala, Configurações e Mais (exceto o painel de debug em desenvolvimento).

---

## 5. Proteção do gameplay

Durante a partida **não existe anúncio full-screen**. A garantia tem três camadas:

1. `useGameSessionGuard()` na `GameScreen` e `useMatchmakingGuard()` em Matchmaking, Sala e
   Entrar em sala marcam o estado global enquanto a tela existe;
2. `AdFrequencyManager` devolve `game_active` / `matchmaking_active` antes de qualquer conta de
   frequência;
3. `AdService.canShowFullScreenAd()` é uma guarda independente, usada por qualquer caminho novo.

Também bloqueiam: app em background, modal crítico aberto, navegação instável e outro
full-screen já na tela.

Coberto por `src/ads/__tests__/AdService.guards.test.ts` e pelo bloco "guardas de gameplay" em
`AdFrequencyManager.test.ts`.

---

### Telas sem anúncio

Introdução, Login, código (OTP), cadastro, partida, matchmaking e lobby **nunca** mostram anúncio
(`src/ads/config/adFreeScreens.ts`). O `RootNavigator` informa a rota de topo em foco
(`AdState.currentScreen`) e a guarda `isAdFreeScreen` barra interstitial, rewarded, App Open (inclusive
na volta do app de SMS para a tela do código) e Native (`skip reason: ad_free_screen`). Além disso o
`AdService.initialize()` — SDK, formulário de consentimento e pré-carregamento — só roda depois que
o usuário conclui login e cadastro (`status === 'signed_in'`).

## 6. Interstitial

Único ponto automático: **fim de partida**.

```
partida termina → tela de resultado aparece
        ↓ 2,6s (o usuário lê placar e recompensas)
FrequencyManager decide
        ↓
interstitial (se liberado) → fecha → usuário segue na mesma tela
```

O anúncio acontece **antes** de o usuário iniciar uma ação. Tocar em "Jogar novamente" ou
"Voltar ao início" cancela o interstitial pendente — nada de anúncio depois de um clique que
deveria começar outra coisa.

Se o anúncio não estiver carregado, a decisão é **pular**: sem espera, sem spinner, sem atraso
de navegação.

### Política de frequência (defaults)

| Parâmetro | Valor |
| --- | --- |
| `interstitial_min_matches_before_first` | 2 |
| `interstitial_every_n_matches` | 3 |
| `interstitial_cooldown_seconds` | 180 |
| `interstitial_max_per_session` | 4 |
| `interstitial_max_per_day` | 8 |
| `full_screen_global_cooldown_seconds` | 180 |
| `minimum_session_seconds_before_interstitial` | 180 |

### Usuário novo

| Sessão | Intersticiais |
| --- | --- |
| 1ª | **0** — nunca, nem depois da primeira partida |
| 2ª | no máximo 1 |
| 3ª+ | regra padrão |

Primeiro criar valor, depois monetizar.

### Motivos de bloqueio

`ads_disabled`, `interstitial_disabled`, `consent_missing`, `app_background`, `game_active`,
`matchmaking_active`, `modal_open`, `navigation_unstable`, `full_screen_showing`,
`result_already_used_full_screen`, `first_session`, `session_cap`, `daily_cap`,
`session_too_young`, `not_enough_matches`, `cadence`, `cooldown`, `global_cooldown`,
`not_loaded`.

O motivo vai para o evento `ad_skipped_by_frequency` e para o painel de debug.

---

## 7. Rewarded

Formato **prioritário** e sempre opt-in. Nenhum rewarded começa sozinho: o usuário passa por
uma folha de confirmação (`RewardedGate`) com "Agora não" e "Assistir".

A recompensa é liberada **exclusivamente** no callback `EARNED_REWARD` do SDK. Fechar o vídeo
antes mantém o conteúdo bloqueado.

| Placement | O que libera |
| --- | --- |
| `match_analysis_rewarded` | análise completa da partida: rodadas, trucos, fugas, mão mais cara e leituras em texto, tudo derivado dos eventos do motor (`src/features/game/matchAnalysis.ts`) |
| `home_tip_rewarded` | uma dica de estratégia de Truco (`src/ads/content/trucoTips.ts`) |

**Nunca** dá vantagem competitiva: nada de XP, pontos de liga, moedas, cartas, segunda chance,
vantagem no matchmaking ou bônus dentro da partida. Só conteúdo.

### Anúncio duplo

Quem assiste ao rewarded na tela de resultado **não** leva interstitial daquela partida:
`fullScreenUsedForCurrentResult` é marcado e o interstitial responde
`result_already_used_full_screen`. Vale inclusive quando o usuário fecha o rewarded antes do
fim — o anúncio já ocupou a tela, então o cooldown global também conta.

---

## 8. Native Ads

Um card por tela, no máximo, sempre identificado com o rótulo **Patrocinado**
(`SponsoredBadge`) e com o AdChoices no canto superior direito.

Regras de layout:

- visual de conteúdo patrocinado, **não** de botão do jogo (CTA neutro, borda neutra);
- nunca imita jogador, amigo, ranking, notificação, evento ou mensagem;
- na Liga fica **depois do ranking inteiro**, nunca entre posições;
- em Amigos fica no rodapé da lista, nunca entre o nome de um contato e o botão de adicionar;
- distância segura da Bottom Navigation e de qualquer CTA;
- se o anúncio não carregar, o componente **some** — sem espaço vazio e sem loading eterno;
- ao sair da tela o anúncio é destruído e os listeners removidos.

Retentativa em backoff (5s, 15s, 30s, 60s) com no máximo 4 tentativas por montagem.

---

## 9. App Open

Infraestrutura completa, formato **desligado** (`app_open_enabled = false`). Enquanto a flag
for falsa nada é requisitado — nem um load acontece.

Antes de ligar, queremos medir retenção, estabilidade e a receita dos outros formatos. Quando
for a hora, a política já escrita exige: `sessionNumber >= 4`, background ≥ 6h, nenhuma partida
ou matchmaking ativo, nenhum full-screen recente e anúncio carregado. Volta rápida (sair 30s
para responder uma mensagem) nunca mostra anúncio.

---

## 10. Banner

Não priorizado. O SDK suporta, mas o app não coloca banner fixo: Native Ads integram melhor
visualmente e rendem mais no contexto deste jogo.

---

## 11. Privacidade

### Consentimento (UMP)

`ConsentManager` chama `AdsConsent.gatherConsent()` no boot e **nenhum anúncio é requisitado
antes de `canRequestAds()`**. Falha do UMP = sem anúncios, nunca consentimento fabricado.

Quando o SDK indica `privacyOptionsRequirementStatus = REQUIRED`, a tela de Configurações passa
a mostrar **"Privacidade de anúncios"**, que reabre o formulário.

Para QA: `EXPO_PUBLIC_ADMOB_DEBUG_GEOGRAPHY=EEA` + `EXPO_PUBLIC_ADMOB_TEST_DEVICE_IDS`.

### ATT (iOS)

`TrackingManager` existe com um provider plugável. **Pendência**: o prompt do ATT precisa de
`expo-tracking-transparency` (ainda não instalado) e de validação em macOS. O prompt nunca deve
subir no primeiro frame — mostrar contexto antes. Recusar não bloqueia nada no app.

A `NSUserTrackingUsageDescription` já é escrita pelo `app.config.js`.

### Dados

Nenhum evento de anúncio carrega telefone, nome, e-mail, contatos ou conteúdo do usuário. Os
parâmetros são só: `format`, `placement`, `screen`, `session_number`, `matches_completed` e
metadados do próprio anúncio.

### Tráfego inválido

Test Ads podem ser clicados livremente no QA. **Anúncio real, jamais.** O app não incentiva
cliques, não automatiza interação e não usa linguagem do tipo "clique para nos ajudar" — o
rewarded oferece assistir voluntariamente em troca de um conteúdo definido, e só.

---

## 12. Configuração remota

Todas as chaves vivem em `remoteConfigDefaults` (`src/services/firebase/remoteConfig.ts`) e em
`remoteconfig.template.json`, e viram `AdConfig` via `remoteAdConfigSource`.

| Chave | Default |
| --- | --- |
| `ads_enabled` | `true` |
| `interstitial_enabled` | `true` |
| `rewarded_enabled` | `true` |
| `native_enabled` | `true` |
| `app_open_enabled` | `false` |
| `interstitial_min_matches_before_first` | `2` |
| `interstitial_every_n_matches` | `3` |
| `interstitial_cooldown_seconds` | `180` |
| `interstitial_max_per_session` | `4` |
| `interstitial_max_per_day` | `8` |
| `full_screen_global_cooldown_seconds` | `180` |
| `minimum_session_seconds_before_interstitial` | `180` |
| `native_home_enabled` | `true` |
| `native_league_enabled` | `true` |
| `native_friends_enabled` | `true` |
| `native_profile_enabled` | `false` |
| `rewarded_analysis_enabled` | `true` |
| `rewarded_tip_enabled` | `true` |
| `app_open_min_session_number` | `4` |
| `app_open_min_background_seconds` | `21600` |

### Kill switch

`ads_enabled = false` desliga interstitial, rewarded, native e app open imediatamente, sem
publicar versão nova.

### A/B tests preparados

Nada de estratégia hardcoded — tudo acima é configurável remotamente:

- cadência do interstitial: 2 vs. 3 vs. 4 partidas;
- cooldown: 180s vs. 300s;
- Native na Principal ligado vs. desligado (medir receita, retenção, cliques em "Jogar" e
  partidas por sessão);
- CTA do rewarded: "Ver análise completa" vs. outra formulação — sem linguagem enganosa.

---

## 13. Telemetria

Eventos: `ad_request`, `ad_loaded`, `ad_failed`, `ad_impression_logged`, `ad_clicked`,
`ad_opened`, `ad_closed`, `ad_reward_earned`, `ad_reward_declined`, `ad_skipped_by_frequency`,
`ad_revenue_paid`, `ad_consent_resolved`, `rewarded_offer_shown`, `rewarded_offer_accepted`.

> `ad_impression`, `ad_click`, `ad_query`, `ad_reward` e `ad_exposure` são nomes **reservados**
> do Firebase Analytics (coleta automática do Mobile Ads SDK). Eventos nossos com esses nomes
> seriam descartados — por isso os sufixos `_logged` / `_clicked` / `_earned`.

Todos carregam `format`, `placement`, `screen`, `session_number` e `matches_completed`.

### Receita por impressão

O listener de `AdEventType.PAID` (e `NativeAdEventType.PAID`) já está ligado e emite
`ad_revenue_paid` com `value_micros`, `currency_code`, `precision`, `ad_unit` e `placement`.
O dado só chega com anúncio real e com o recurso ligado no painel do AdMob.

### Métricas para acompanhar depois da produção

ARPDAU, ARPU, eCPM, fill rate, show rate, impressões/sessão, receita/sessão, partidas/sessão,
sessões/usuário, retenção D1/D7/D30 e crash free users.

Ao mexer na frequência, comparar **receita e retenção juntas**. eCPM subir não é motivo para
aumentar a frequência.

---

## 14. Debug

Em desenvolvimento, **Mais → Anúncios (debug)** abre um painel com ambiente, modo (TEST ADS),
consentimento, estado de carregamento de cada formato, número da sessão, contadores de sessão e
de dia, partidas desde o último anúncio, a decisão atual do interstitial (liberado ou motivo do
bloqueio) e as guardas de gameplay.

Logs `[ADS]...` só existem em `__DEV__`.

---

## 15. Testes

| Arquivo | Cobre |
| --- | --- |
| `src/ads/__tests__/AdFrequencyManager.test.ts` | sessões 1/2/3+, cadência por partidas, cooldowns, caps diário e de sessão, sessão jovem, guardas de gameplay, kill switch, consentimento, rewarded+interstitial no mesmo resultado, anúncio não carregado, App Open |
| `src/ads/__tests__/AdService.guards.test.ts` | `canShowFullScreenAd` em cada guarda; interstitial durante partida |
| `src/ads/__tests__/adUnits.test.ts` | Test Ads obrigatórios em dev/staging; produção sem ID = desligado |
| `src/ads/__tests__/rewardedFlow.test.ts` | recompensa só com `EARNED_REWARD`; fechar antes não libera; supressão do interstitial; bloqueios |
| `src/ads/__tests__/NativeAdCard.test.tsx` | anúncio identificado; falha não deixa buraco; consentimento e kill switch; destruição no unmount |
| `src/features/game/__tests__/matchAnalysis.test.ts` | conteúdo do rewarded derivado dos eventos do motor |

O SDK é mockado em `__mocks__/react-native-google-mobile-ads.ts` (os `TestIds` vêm do arquivo
real da biblioteca, para não envelhecerem).

---

## 16. Onde colocar os IDs reais no futuro

Nada de ID real entra no código. Tudo passa por `.env` (ver `.env.example`):

| Variável | Usada em |
| --- | --- |
| `EXPO_PUBLIC_ADMOB_ANDROID_APP_ID` / `..._IOS_APP_ID` | `app.config.js` → AndroidManifest / Info.plist |
| `EXPO_PUBLIC_ADMOB_{ANDROID,IOS}_INTERSTITIAL_MATCH_RESULT` | `adUnits.ts` → `match_result_interstitial` |
| `EXPO_PUBLIC_ADMOB_{ANDROID,IOS}_REWARDED_MATCH_ANALYSIS` | `adUnits.ts` → `match_analysis_rewarded` |
| `EXPO_PUBLIC_ADMOB_{ANDROID,IOS}_REWARDED_HOME_TIP` | `adUnits.ts` → `home_tip_rewarded` |
| `EXPO_PUBLIC_ADMOB_{ANDROID,IOS}_NATIVE_HOME` | `adUnits.ts` → `home_native_primary` |
| `EXPO_PUBLIC_ADMOB_{ANDROID,IOS}_NATIVE_LEAGUE` | `adUnits.ts` → `league_native_footer` |
| `EXPO_PUBLIC_ADMOB_{ANDROID,IOS}_NATIVE_FRIENDS` | `adUnits.ts` → `friends_native_footer` |
| `EXPO_PUBLIC_ADMOB_{ANDROID,IOS}_NATIVE_PROFILE` | `adUnits.ts` → `profile_native` |
| `EXPO_PUBLIC_ADMOB_{ANDROID,IOS}_APP_OPEN` | `adUnits.ts` → `app_open` |

Além disso, `EXPO_PUBLIC_APP_ENV=production` é o que habilita o uso desses IDs.

---

## Checklist para produção

Nada disto foi executado nesta etapa.

### AdMob

- [ ] criar o app Android no AdMob
- [ ] criar o app iOS no AdMob
- [ ] criar as unidades (1 interstitial, 2 rewarded, 4 native, 1 app open)
- [ ] preencher os App IDs e os IDs de unidade no `.env`
- [ ] configurar as mensagens de privacidade (UMP/GDPR e regulamentação dos EUA)
- [ ] publicar `app-ads.txt` no domínio declarado na loja
- [ ] registrar dispositivos de teste (`EXPO_PUBLIC_ADMOB_TEST_DEVICE_IDS`)
- [ ] validar em build de produção **sem clicar** em nenhum anúncio real
- [ ] avaliar mediação só depois de haver dados reais suficientes (preferir bidding)

### Google Play

- [ ] declarar que o app contém anúncios
- [ ] preencher a seção de Segurança de Dados (Data Safety)
- [ ] atualizar a política de privacidade citando publicidade e parceiros

### Apple

- [ ] preencher App Privacy (incluindo a declaração de tracking)
- [ ] incluir o privacy manifest quando exigido
- [ ] instalar e configurar `expo-tracking-transparency`, e validar o ATT em macOS
- [ ] revisar `SKAdNetworkItems` no `app.config.js`

### Estratégia recomendada para o primeiro release

Native na Principal, Liga e Amigos; Rewarded de análise e de dicas; interstitial a cada 3
partidas; App Open desligado. Só depois de medir retenção e receita é que se avalia ligar o App
Open e, mais tarde ainda, mediação.
