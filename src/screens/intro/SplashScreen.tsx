import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients } from '@/design-system';
import { images } from '@/assets';

export function SplashScreen() {
  return (
    <View style={styles.root} testID="screen-splash">
      <LinearGradient colors={gradients.screen} style={StyleSheet.absoluteFill} />
      <Image source={images.logo} style={styles.logo} contentFit="contain" />
      <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgTop },
  logo: { width: 220, height: 96 },
});
