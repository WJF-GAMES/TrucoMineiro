import React from 'react';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '@/design-system';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { RootStackParamList } from './types';
import { MainTabs } from './MainTabs';
import { SplashScreen } from '@/screens/intro/SplashScreen';
import { IntroScreen } from '@/screens/intro/IntroScreen';
import { LoginScreen } from '@/screens/auth/LoginScreen';
import { OtpScreen } from '@/screens/auth/OtpScreen';
import { RegisterScreen } from '@/screens/auth/RegisterScreen';
import { AiSetupScreen } from '@/screens/play/AiSetupScreen';
import { OnlineHubScreen } from '@/screens/online/OnlineHubScreen';
import { MatchmakingScreen } from '@/screens/online/MatchmakingScreen';
import { JoinRoomScreen } from '@/screens/online/JoinRoomScreen';
import { LobbyScreen } from '@/screens/online/LobbyScreen';
import { GameScreen } from '@/screens/game/GameScreen';
import { MatchResultScreen } from '@/screens/game/MatchResultScreen';
import { ProfileScreen } from '@/screens/profile/ProfileScreen';
import { EditProfileScreen } from '@/screens/profile/EditProfileScreen';
import { SettingsScreen } from '@/screens/settings/SettingsScreen';
import { NotificationsScreen } from '@/screens/more/NotificationsScreen';
import { AchievementsScreen } from '@/screens/profile/AchievementsScreen';
import { MatchHistoryScreen } from '@/screens/profile/MatchHistoryScreen';
import { StaticPageScreen } from '@/screens/more/StaticPageScreen';
import { logScreen } from '@/services/firebase/analytics';
import { setCrashContext } from '@/services/firebase/crashlytics';
import { useFriendInviteLink } from '@/features/friends/useFriendInviteLink';
import { useRoomInvitePrompt } from '@/features/friends/useRoomInvitePrompt';
import { usePendingRoomInvite } from '@/features/friends/usePendingRoomInvite';
import { navigationRef } from './navigationRef';
import { useAdStore } from '@/ads/core/AdState';

/** Rota de topo em foco — é ela que decide se a tela admite anúncio (`AD_FREE_SCREENS`). */
function syncAdScreen() {
  if (!navigationRef.isReady()) return;
  const root = navigationRef.getRootState();
  const name = root?.routes[root.index]?.name ?? null;
  if (useAdStore.getState().currentScreen !== name) useAdStore.getState().setCurrentScreen(name);
}

const Stack = createNativeStackNavigator<RootStackParamList>();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bgTop,
    card: colors.bgTop,
    primary: colors.primary,
    text: colors.text,
  },
};

export function RootNavigator() {
  const status = useAuthStore((s) => s.status);
  const hasSeenIntro = useSettingsStore((s) => s.hasSeenIntro);
  const [routeName, setRouteName] = React.useState<string | null>(null);
  // Convite por QR Code / link: precisa valer em qualquer tela, não só em Amigos.
  useFriendInviteLink();
  // Convite de sala de um amigo: o mesmo vale aqui — chega pelo Realtime Database a qualquer hora.
  useRoomInvitePrompt(routeName);
  // Toque no push / link de sala: guardado até dar para entrar (login e cadastro no meio).
  usePendingRoomInvite(routeName);

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={theme}
      onReady={() => {
        syncAdScreen();
        // O primeiro estado não dispara `onStateChange`: sem isto, quem abre o app pelo push
        // ficaria sem rota conhecida até navegar.
        const root = navigationRef.getRootState();
        const name = root?.routes[root.index]?.name;
        if (name) setRouteName(name);
      }}
      onStateChange={(state) => {
        syncAdScreen();
        const name = state?.routes[state.index]?.name;
        if (name && name !== routeName) {
          setRouteName(name);
          logScreen(name);
          setCrashContext({ screen: name });
        }
      }}
    >
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'fade_from_bottom',
          contentStyle: { backgroundColor: colors.bgTop },
        }}
      >
        {status === 'booting' ? (
          <Stack.Screen name="Splash" component={SplashScreen} />
        ) : status === 'signed_out' ? (
          <>
            {!hasSeenIntro ? <Stack.Screen name="Intro" component={IntroScreen} /> : null}
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Otp" component={OtpScreen} />
            {hasSeenIntro ? <Stack.Screen name="Intro" component={IntroScreen} /> : null}
          </>
        ) : status === 'onboarding' ? (
          <Stack.Screen name="Register" component={RegisterScreen} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="AiSetup" component={AiSetupScreen} />
            <Stack.Screen name="OnlineHub" component={OnlineHubScreen} />
            <Stack.Screen
              name="Matchmaking"
              component={MatchmakingScreen}
              options={{ gestureEnabled: false }}
            />
            <Stack.Screen name="JoinRoom" component={JoinRoomScreen} />
            <Stack.Screen
              name="Lobby"
              component={LobbyScreen}
              options={{ gestureEnabled: false }}
            />
            <Stack.Screen
              name="Game"
              component={GameScreen}
              options={{ gestureEnabled: false, animation: 'fade' }}
            />
            <Stack.Screen
              name="MatchResult"
              component={MatchResultScreen}
              options={{ gestureEnabled: false, animation: 'fade' }}
            />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="EditProfile" component={EditProfileScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="Achievements" component={AchievementsScreen} />
            <Stack.Screen name="MatchHistory" component={MatchHistoryScreen} />
            <Stack.Screen name="StaticPage" component={StaticPageScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
