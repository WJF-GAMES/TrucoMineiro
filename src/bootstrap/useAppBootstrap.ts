import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFonts } from 'expo-font';
// Um import por peso: o índice do pacote faz `require` dos 18 TTFs do Nunito (itálicos e pesos
// finos inclusos) e o Metro empacotaria todos no APK, mesmo sem uso.
import { Nunito_400Regular } from '@expo-google-fonts/nunito/400Regular';
import { Nunito_500Medium } from '@expo-google-fonts/nunito/500Medium';
import { Nunito_600SemiBold } from '@expo-google-fonts/nunito/600SemiBold';
import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';
import { Nunito_800ExtraBold } from '@expo-google-fonts/nunito/800ExtraBold';
import { Nunito_900Black } from '@expo-google-fonts/nunito/900Black';
import { KaushanScript_400Regular } from '@expo-google-fonts/kaushan-script/400Regular';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { useNetworkStore } from '@/stores/networkStore';
import { onAuthStateChanged } from '@/services/firebase/auth';
import {
  bootstrapUser,
  connectPresence,
  getProfileFromServer,
  setAppForeground,
  subscribeConnection,
  subscribeMyProfile,
} from '@/services/api';
import { initRemoteConfig } from '@/services/firebase/remoteConfig';
import { initAppCheck } from '@/services/firebase/appCheck';
import { identifyUser, logEvent } from '@/services/firebase/analytics';
import { reportError, setCrashUser } from '@/services/firebase/crashlytics';
import { setupPushNotifications } from '@/services/firebase/messaging';
import { startTrace } from '@/services/firebase/perf';
import { AdService } from '@/ads';
import { resolveOnboarding } from './resolveOnboarding';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Boots the app: fonts, App Check, Remote Config, auth listener, bootstrap no backend, perfil ao
 * vivo, tempo real (presença) e push. Returns true when the UI can be shown.
 */
export function useAppBootstrap(): boolean {
  const [fontsLoaded] = useFonts({
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    Nunito_900Black,
    KaushanScript_400Regular,
  });
  const [servicesReady, setServicesReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stop = await startTrace('app_startup');
      await initAppCheck();
      await initRemoteConfig();
      logEvent('app_open');
      if (!cancelled) setServicesReady(true);
      await stop();
    })().catch((e) => {
      reportError(e, 'bootstrap');
      setServicesReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const auth = useAuthStore.getState();
    const profileStore = useProfileStore.getState();
    let cleanups: (() => void)[] = [];
    const unsubAuth = onAuthStateChanged(async (user) => {
      cleanups.forEach((c) => c());
      cleanups = [];
      if (!user) {
        identifyUser(null);
        setCrashUser(null);
        profileStore.reset();
        auth.setSignedOut();
        return;
      }
      identifyUser(user.uid);
      setCrashUser(user.uid);
      // Quem decide entre cadastro e Home é o servidor (bootstrap ou o perfil lido nele). Nunca
      // "chuta": usuário novo não cai na Home sem apelido, e quem já tem cadastro não refaz o cadastro
      // só porque o cache local do aparelho ainda está vazio.
      const onboarded = await resolveOnboarding({
        bootstrap: () => bootstrapUser(),
        serverProfile: () => getProfileFromServer(user.uid),
        report: reportError,
      });
      const decide = (complete: boolean) => {
        if (useAuthStore.getState().user?.uid === user.uid) return;
        auth.setUser(user, complete);
      };
      if (onboarded !== null) decide(onboarded);
      // Tempo real (presença, convites, partida) — a conexão autentica com o mesmo ID Token.
      cleanups.push(connectPresence(user.uid));
      cleanups.push(
        subscribeMyProfile(
          ({ profile: p, stats }) => {
            profileStore.setProfile(p);
            profileStore.setStats(stats);
            const complete = Boolean(p?.nickname);
            if (onboarded === null) decide(complete);
            const store = useAuthStore.getState();
            if (complete && store.status === 'onboarding') store.setOnboarded();
            // Perfil que existe sem apelido (cadastro interrompido): volta para o cadastro.
            else if (p && !complete && store.status === 'signed_in') store.setNeedsOnboarding();
          },
          (err) => {
            profileStore.setError(err.message);
            // O servidor respondeu com erro e nada decidiu antes: o cadastro é o caminho seguro
            // (ele cria o que faltar) — melhor que prender o usuário na abertura.
            if (onboarded === null) decide(false);
          },
        ),
      );
      setupPushNotifications().then((u) => cleanups.push(u));
    });
    const unsubConn = subscribeConnection((c) => useNetworkStore.getState().setConnected(c));
    // Segundo plano: presença "em segundo plano"; de volta: reconecta e reafirma o estado.
    const appState = AppState.addEventListener('change', (next) => setAppForeground(next === 'active'));
    return () => {
      unsubAuth();
      unsubConn();
      appState.remove();
      cleanups.forEach((c) => c());
    };
  }, []);

  const ready = fontsLoaded && servicesReady;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  /**
   * Monetização entra **depois** do login e do cadastro: Intro, Login, código e cadastro são
   * livres de anúncio — nem o formulário de consentimento nem pré-carregamento acontecem ali.
   * Falhar aqui não afeta nada do jogo — o app só fica sem anúncios.
   */
  const authStatus = useAuthStore((s) => s.status);
  useEffect(() => {
    if (!ready || authStatus !== 'signed_in') return;
    // A liga já foi garantida pelo bootstrap (uma chamada só depois do login).
    AdService.initialize().catch((e) => reportError(e, 'ads.initialize'));
  }, [ready, authStatus]);

  return ready;
}
