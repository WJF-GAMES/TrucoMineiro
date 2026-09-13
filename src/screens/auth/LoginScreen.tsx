import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors, radius, spacing } from '@/design-system';
import { images } from '@/assets';
import { AppText, CountryFlag, PhoneInput, PrimaryButton } from '@/components';
import { COUNTRIES, PHONE_PLACEHOLDER } from '@/utils/phone';
import { usePhoneLogin } from '@/features/auth/usePhoneLogin';
import { logEvent } from '@/services/firebase/analytics';
import type { RootScreenProps } from '@/navigation/types';

/** Proporções naturais das artes recortadas de references/login.png. */
const HERO_RATIO = 1396 / 948;
const FOOTER_RATIO = 1396 / 726;

/** Entrada por telefone (único método). Introdução → COMEÇAR → aqui → OTP. */
export function LoginScreen({ navigation }: RootScreenProps<'Login'>) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [pickerOpen, setPickerOpen] = useState(false);
  const { country, phone, error, loading, canContinue, changeCountry, changePhone, submit } =
    usePhoneLogin(() => navigation.navigate('Otp'));

  // No print a paisagem ocupa ~41% da tela. Em telas mais altas ela cresce até lá
  // (o `cover` corta um pouco das laterais, nunca a logo) e nunca mais que 35% do natural.
  const naturalHero = width / HERO_RATIO;
  const heroHeight = Math.min(Math.max(naturalHero, height * 0.41), naturalHero * 1.35);

  useEffect(() => {
    logEvent('phone_login_started');
  }, []);

  return (
    <View style={styles.root} testID="screen-login">
      <StatusBar style="light" />
      <Image
        source={images.loginHeader}
        style={[styles.hero, { height: heroHeight }]}
        contentFit="cover"
        contentPosition="bottom"
        accessibilityLabel="Truco Mineiro: tradição em cada jogada"
      />
      <Image
        source={images.loginFooter}
        style={[styles.foliage, { height: width / FOOTER_RATIO }]}
        contentFit="cover"
        pointerEvents="none"
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 16 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ height: heroHeight - spacing.xs }} />
          {/* Sobra de altura vai quase toda para o rodapé (é lá que fica a vegetação),
              mas um naco fica acima do título para o bloco cair onde cai no print. */}
          <View style={styles.spacerTop} />

          <AppText variant="display" center>
            Bem-vindo de volta!
          </AppText>
          <AppText variant="body" center color={colors.textSecondary} style={styles.subtitle}>
            Entre com seu número de telefone{'\n'}para continuar.
          </AppText>

          <View style={styles.form}>
            <PhoneInput
              country={country}
              onPressCountry={() => setPickerOpen(true)}
              value={phone}
              onChangeText={changePhone}
              placeholder={PHONE_PLACEHOLDER[country.code]}
              error={Boolean(error)}
              autoFocus
            />
            {error ? (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle" size={15} color={colors.dangerSoft} />
                <AppText variant="small" color={colors.dangerSoft} style={styles.errorText}>
                  {error}
                </AppText>
              </View>
            ) : null}
            <PrimaryButton
              label="Continuar"
              onPress={submit}
              loading={loading}
              disabled={!canContinue}
              style={styles.cta}
              testID="login-continue"
            />
          </View>

          <View style={styles.secure} accessible accessibilityRole="text">
            <Ionicons name="shield-checkmark" size={22} color={colors.cream} />
            <View style={styles.secureDivider} />
            <AppText variant="small" color={colors.textSecondary} style={styles.secureText}>
              Seus dados estão protegidos
            </AppText>
          </View>

          <View style={styles.spacerBottom} />

          <AppText variant="bodyBold" center style={styles.values}>
            Respeito <AppText style={styles.bullet}>•</AppText> Amizade{' '}
            <AppText style={styles.bullet}>•</AppText> Boa Resenha
          </AppText>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(false)}>
          <View style={styles.modalCard}>
            <AppText variant="h3" style={styles.modalTitle}>
              Escolha o país
            </AppText>
            {COUNTRIES.map((c) => (
              <Pressable
                key={c.code}
                accessibilityRole="button"
                accessibilityLabel={`${c.name}, ${c.dial}`}
                accessibilityState={{ selected: c.code === country.code }}
                onPress={() => {
                  changeCountry(c);
                  setPickerOpen(false);
                }}
                style={styles.countryRow}
              >
                <CountryFlag country={c} width={26} />
                <AppText variant="body" style={styles.countryName}>
                  {c.name}
                </AppText>
                <AppText variant="bodyBold" color={colors.textSecondary}>
                  {c.dial}
                </AppText>
                {c.code === country.code ? (
                  <Ionicons
                    name="checkmark"
                    size={20}
                    color={colors.primaryBright}
                    style={styles.check}
                  />
                ) : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgTop },
  flex: { flex: 1 },
  hero: { position: 'absolute', top: 0, left: 0, right: 0 },
  foliage: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  content: { paddingHorizontal: spacing.screen, flexGrow: 1 },
  spacerTop: { flex: 0.4 },
  spacerBottom: { flex: 1, minHeight: spacing.xxl },
  subtitle: { marginTop: 6, fontSize: 15 },
  form: { marginTop: spacing.xl },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, marginLeft: 4 },
  errorText: { flex: 1 },
  cta: { marginTop: spacing.lg },
  secure: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.sm,
  },
  secureDivider: {
    width: 1,
    height: 30,
    backgroundColor: colors.divider,
    marginHorizontal: spacing.md,
  },
  secureText: { lineHeight: 17 },
  values: { marginTop: spacing.lg, fontSize: 15 },
  bullet: { color: colors.primaryBright },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    backgroundColor: colors.cardSolid,
    borderRadius: radius.card,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cardBorderStrong,
  },
  modalTitle: { marginBottom: 8 },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  countryName: { flex: 1, marginLeft: 10 },
  check: { marginLeft: 8 },
});
