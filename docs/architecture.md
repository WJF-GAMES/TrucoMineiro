# Arquitetura — Truco Mineiro / TrucoX

## Stack
- **Mobile**: React Native 0.86 + Expo SDK 57 (dev-client / prebuild, New Architecture), TypeScript strict.
- **Backend**: 100% Firebase (Auth por telefone, Firestore, Realtime Database, Cloud Functions 2nd gen em `southamerica-east1`, Storage, FCM, Remote Config, App Check, Analytics, Crashlytics, Performance, Emulator Suite).
- Sem servidor próprio, sem banco relacional, sem WebSocket próprio.

## Estrutura de pastas
```
src/
  bootstrap/        App raiz + useAppBootstrap (fontes, App Check, Remote Config, auth listener, presença, push)
  design-system/    tokens (colors, typography, spacing, radius, shadows, motion, icons)
  components/       componentes reutilizáveis (ver docs/design-system.md)
  navigation/       RootNavigator (stack), MainTabs + BottomNavigation (custom tab bar), types
  screens/          intro, auth, home, play, online, game, league, friends, more, store, profile, settings
  features/game/    controladores de mesa: useAiGame (local) e useOnlineGame (RTDB + Functions) → TableController
  features/friends/ amigos, agenda e convites: contactsMatch (puro), contactsCache, useFriends,
                    useContactsSync, useFriendInviteLink (deep link do QR), useRoomInvites +
                    useRoomInvitePrompt (convite de sala pelo RTDB)
  domain/
    game/           GAME ENGINE puro (cards, deck, rules, state, engine, ai) — não importa react/react-native/firebase (lint proíbe)
    model/          tipos do modelo persistente, ligas, catálogo da loja (compartilhados com Functions)
  ads/              monetização por anúncios (Google Mobile Ads): AdService + frequência + placements
                    nomeados + consentimento (UMP). Nenhuma tela fala com o SDK — ver docs/ADMOB_MONETIZATION.md
  services/firebase/ wrappers tipados de cada SDK + emulator switch (EXPO_PUBLIC_USE_EMULATORS=1)
  services/contacts.ts  agenda do aparelho (expo-contacts): permissão + leitura paginada de nome/telefones
  stores/           Zustand: auth, profile, settings (persistido), network, toast — stores pequenos e separados
  utils/            format, phone (E.164 + normalizePhoneNumber via libphonenumber-js), haptics
functions/          Cloud Functions (TypeScript). `npm run build` copia src/domain → functions/src/domain
scripts/            extract-assets.py (recortes da referência), simulate-ai.ts (milhares de partidas)
references/         referências individuais recortadas de referencia.png
artifacts/          screenshots e comparações visuais (QA)
```

## Fluxo de dados
```
UI (screens) → stores (Zustand) → services/firebase → Firebase
                                 ↘ domain/game (engine puro) ↙ (também executado nas Functions)
```
- **Contra a IA**: partida roda localmente com o engine; cada decisão de IA vê apenas `AIObservation`
  (projeção do `SeatView`). Ao final o cliente envia `{seed, aiSeed, difficulty, actions}` para `finalizeMatch`;
  o servidor **re-executa** a partida (engine determinístico) e só então concede XP/liga.
- **Online**: o cliente nunca é autoridade. Ações vão por `submitGameAction` (callable, idempotente por `clientActionId`);
  o estado privado fica em `gameSessions/{id}/state` (sem leitura por clientes) e cada assento recebe sua
  projeção em `gameSessions/{id}/views/{seat}` (regra RTDB garante que só o dono do assento lê).
- **Amigos pela agenda**: `services/contacts` lê a agenda em páginas; `features/friends/contactsMatch`
  normaliza para E.164, deduplica e fatia em lotes de 200; `matchPhoneContacts` devolve quem tem conta
  pelo *índice* do número. Nenhum nome sai do aparelho e nenhum telefone volta (ver docs/security.md).
- **Convite de sala entre amigos**: "Jogar" cria a sala (`createRoom`) e chama `inviteFriendToRoom`,
  que grava `invites/{amigo}/{code}` no RTDB e manda push. O convidado lê esse nó ao vivo
  (`useRoomInvites`): a aba Amigos mostra a linha "Convites para jogar" e o resto do app recebe um
  diálogo (`useRoomInvitePrompt`, silencioso durante a partida). Entrar chama `joinRoom` e vai para o
  lobby; entrar, recusar ou vencer o prazo (15 min) apaga o nó — as regras do RTDB só permitem que o
  dono leia e apague os seus convites.
- **Bots online**: `advanceBots` aplica exatamente uma ação de bot por chamada; os clientes chamam após ~900 ms
  quando é a vez de um bot (transação no RTDB evita duplicidade).

## Estados separados (performance)
GameState (engine/view) · UIState (telas/stores) · AnimationState (Reanimated local) · NetworkState (`networkStore`, `.info/connected`).

## Segurança
- Firestore/RTDB/Storage: **deny by default**; clientes só leem. Toda escrita crítica é via Functions (Admin SDK).
- Functions validam Auth, App Check (fora do emulador), payload, ownership, estado e concorrência (transações).
- Idempotência: `matchHistory/{matchId}` como lock de progressão; `rewards/{uid}_{rewardId}`; `appliedActionIds` na sessão.

## Decisões
- Ladder de apostas 1 → 3 (Truco) → 6 → 9 → 12 conforme requisito funcional (Seis/Nove/Doze).
- Manilhas fixas do Truco Mineiro: Zap (4♣) > 7♥ > Espadilha (A♠) > 7♦.
- Mão de onze: time com 11 decide jogar (vale 3) ou entregar 1; 11×11 joga normal sem truco.
- Empate nas três rodadas: mão sem pontos.
