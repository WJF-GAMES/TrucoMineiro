import { useEffect, useState } from 'react';
import { useFonts } from 'expo-font';
import {
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  Nunito_900Black,
} from '@expo-google-fonts/nunito';
import { KaushanScript_400Regular } from '@expo-google-fonts/kaushan-script';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { useNetworkStore } from '@/stores/networkStore';
import { onAuthStateChanged } from '@/services/firebase/auth';
import { bootstrapUser, ensureUserLeagueAssignment } from '@/services/firebase/functions';
import {
  getProfileFromServer,
  subscribeProfile,
  subscribeStats,
} from '@/services/firebase/firestore';
import { connectPresence, subscribeConnection } from '@/services/firebase/rtdb';
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
 * Boots the app: fonts, App Check, Remote Config, auth listener, profile subscriptions,
 * presence and push registration. Returns true when the UI can be shown.
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
        bootstrap: bootstrapUser,
        serverProfile: () => getProfileFromServer(user.uid),
        report: reportError,
      });
      const decide = (complete: boolean) => {
        if (useAuthStore.getState().user?.uid === user.uid) return;
        auth.setUser(user, complete);
      };
      if (onboarded !== null) decide(onboarded);
      cleanups.push(
        subscribeProfile(
          user.uid,
          (p, fromCache) => {
            profileStore.setProfile(p);
            const complete = Boolean(p?.nickname);
            // Servidor fora: um perfil completo (mesmo do cache) basta para entrar; "sem perfil" só
            // vale quando confirmado pelo servidor.
            if (onboarded === null && (complete || !fromCache)) decide(complete);
            const store = useAuthStore.getState();
            if (complete && store.status === 'onboarding') store.setOnboarded();
            // Perfil que existe sem apelido (cadastro interrompido): volta para o cadastro.
            else if (p && !complete && !fromCache && store.status === 'signed_in')
              store.setNeedsOnboarding();
          },
          (err) => {
            profileStore.setError(err.message);
            // O servidor respondeu com erro e nada decidiu antes: o cadastro é o caminho seguro
            // (ele cria o que faltar) — melhor que prender o usuário na abertura.
            if (onboarded === null) decide(false);
          },
        ),
        subscribeStats(user.uid, (s) => profileStore.setStats(s)),
        connectPresence(user.uid),
      );
      setupPushNotifications().then((u) => cleanups.push(u));
    });
    const unsubConn = subscribeConnection((c) => useNetworkStore.getState().setConnected(c));
    return () => {
      unsubAuth();
      unsubConn();
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
    AdService.initialize().catch((e) => reportError(e, 'ads.initialize'));
    // Garantia de liga a cada entrada no app: idempotente e barata quando já está tudo certo.
    ensureUserLeagueAssignment().catch((e) => reportError(e, 'ensureUserLeagueAssignment'));
  }, [ready, authStatus]);

  return ready;
}
