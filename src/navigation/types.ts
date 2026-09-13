import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { AIDifficultyId } from '@/domain/model/types';
import type { MatchAnalysis } from '@/features/game/matchAnalysis';

export type StaticPageKind = 'terms' | 'privacy' | 'help' | 'about' | 'privacy_security' | 'tips';

export type MainTabParamList = {
  Home: undefined;
  Play: undefined;
  League: undefined;
  Friends: { tab?: 'friends' | 'requests' | 'search' } | undefined;
  More: undefined;
};

export type RootStackParamList = {
  Splash: undefined;
  Intro: undefined;
  Login: undefined;
  Otp: undefined;
  Register: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  AiSetup: undefined;
  OnlineHub: undefined;
  Matchmaking: undefined;
  JoinRoom: undefined;
  Lobby: { code: string };
  Game:
    | { mode: 'ai'; difficulty: AIDifficultyId; seed?: number }
    | { mode: 'online'; sessionId: string };
  MatchResult: {
    mode: 'ai' | 'online';
    won: boolean;
    scores: [number, number];
    difficulty?: AIDifficultyId;
    xpGained?: number;
    coinsGained?: number;
    leaguePointsDelta?: number;
    leveledUp?: boolean;
    /** Resumo da partida calculado a partir dos eventos do motor (conteúdo do Rewarded). */
    analysis?: MatchAnalysis;
    rematch?:
      { mode: 'ai'; difficulty: AIDifficultyId } | { mode: 'online'; roomCode: string | null };
  };
  Profile: undefined;
  EditProfile: undefined;
  Settings: undefined;
  Notifications: undefined;
  Ranking: undefined;
  Achievements: undefined;
  MatchHistory: undefined;
  StaticPage: { kind: StaticPageKind };
};

export type RootNavigation = NativeStackNavigationProp<RootStackParamList>;
export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;
export type TabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
