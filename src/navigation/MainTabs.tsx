import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { MainTabParamList } from './types';
import { BottomNavigation } from './BottomNavigation';
import { HomeScreen } from '@/screens/home/HomeScreen';
import { PlayScreen } from '@/screens/play/PlayScreen';
import { LeagueScreen } from '@/screens/league/LeagueScreen';
import { FriendsScreen } from '@/screens/friends/FriendsScreen';
import { MoreScreen } from '@/screens/more/MoreScreen';

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <BottomNavigation {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: '#00221a' } }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Play" component={PlayScreen} />
      <Tab.Screen name="League" component={LeagueScreen} />
      <Tab.Screen name="Friends" component={FriendsScreen} />
      <Tab.Screen name="More" component={MoreScreen} />
    </Tab.Navigator>
  );
}
