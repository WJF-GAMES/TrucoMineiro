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
import { StoreScreen } from '@/screens/store/StoreScreen';
import { ProfileScreen } from '@/screens/profile/ProfileScreen';
import { EditProfileScreen } from '@/screens/profile/EditProfileScreen';
import { SettingsScreen } from '@/screens/settings/SettingsScreen';
import { NotificationsScreen } from '@/screens/more/NotificationsScreen';
import { RankingScreen } from '@/screens/league/RankingScreen';
import { AchievementsScreen } from '@/screens/profile/AchievementsScreen';
import { MatchHistoryScreen } from '@/screens/profile/MatchHistoryScreen';
import { StaticPageScreen } from '@/screens/more/StaticPageScreen';
import { logScreen } from '@/services/firebase/analytics';
import { setCrashContext } from '@/services/firebase/crashlytics';

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
  const routeNameRef = React.useRef<string | undefined>(undefined);

  return (
    <NavigationContainer
      theme={theme}
      onStateChange={(state) => {
        const name = state?.routes[state.index]?.name;
        if (name && name !== routeNameRef.current) {
          routeNameRef.current = name;
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
            <Stack.Screen name="Store" component={StoreScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="EditProfile" component={EditProfileScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="Ranking" component={RankingScreen} />
            <Stack.Screen name="Achievements" component={AchievementsScreen} />
            <Stack.Screen name="MatchHistory" component={MatchHistoryScreen} />
            <Stack.Screen name="StaticPage" component={StaticPageScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
