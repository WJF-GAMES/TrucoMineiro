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
import { bootstrapUser } from '@/services/firebase/functions';
import { subscribeProfile, subscribeStats } from '@/services/firebase/firestore';
import { connectPresence, subscribeConnection } from '@/services/firebase/rtdb';
import { initRemoteConfig } from '@/services/firebase/remoteConfig';
import { initAppCheck } from '@/services/firebase/appCheck';
import { identifyUser, logEvent } from '@/services/firebase/analytics';
import { reportError, setCrashUser } from '@/services/firebase/crashlytics';
import { setupPushNotifications } from '@/services/firebase/messaging';
import { startTrace } from '@/services/firebase/perf';

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
      try {
        const { onboarded } = await bootstrapUser();
        auth.setUser(user, onboarded);
      } catch (e) {
        reportError(e, 'bootstrapUser');
        // Offline or Functions unreachable: let the profile snapshot decide.
        auth.setUser(user, true);
      }
      cleanups.push(
        subscribeProfile(
          user.uid,
          (p) => {
            profileStore.setProfile(p);
            if (p && useAuthStore.getState().status === 'onboarding' && p.nickname)
              useAuthStore.getState().setOnboarded();
          },
          (err) => profileStore.setError(err.message),
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
  return ready;
}
