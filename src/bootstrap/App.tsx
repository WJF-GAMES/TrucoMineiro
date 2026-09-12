import React from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '@/design-system';
import { RootNavigator } from '@/navigation/RootNavigator';
import { ToastHost } from '@/components/Toast';
import { useAppBootstrap } from './useAppBootstrap';

export default function App() {
  const ready = useAppBootstrap();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bgTop }}>
      <SafeAreaProvider>
        {ready ? <RootNavigator /> : <View style={{ flex: 1, backgroundColor: colors.bgTop }} />}
        <ToastHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
