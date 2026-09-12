import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors, radius, spacing } from '@/design-system';
import { images } from '@/assets';
import { AppText, PhoneInput, PrimaryButton, Surface } from '@/components';
import { COUNTRIES, Country, formatAsYouType, PHONE_PLACEHOLDER, toE164 } from '@/utils/phone';
import { signInWithPhoneNumber, AuthError } from '@/services/firebase/auth';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { logEvent } from '@/services/firebase/analytics';
import { haptic } from '@/utils/haptics';
import type { RootScreenProps } from '@/navigation/types';

export function LoginScreen({ navigation }: RootScreenProps<'Login'>) {
  const insets = useSafeAreaInsets();
  const [country, setCountry] = useState<Country>(COUNTRIES[0]!);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const setPending = useAuthStore((s) => s.setPending);

  useEffect(() => {
    logEvent('phone_login_started');
  }, []);

  const e164 = toE164(phone, country.code);
  const canContinue = Boolean(e164) && !loading;

  const submit = async () => {
    if (!e164) {
      setError('Digite um número válido.');
      haptic.error();
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const confirmation = await signInWithPhoneNumber(e164);
      setPending(e164, confirmation);
      logEvent('otp_sent');
      navigation.navigate('Otp');
    } catch (e) {
      const msg = e instanceof AuthError ? e.message : 'Não foi possível enviar o código.';
      setError(msg);
      toast.error('Não foi possível continuar', msg);
      haptic.error();
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root} testID="screen-login">
      <StatusBar style="light" />
      <LinearGradient
        colors={[colors.bgTop, '#062a24', colors.bgBottom]}
        style={StyleSheet.absoluteFill}
      />
      <Image
        source={images.loginHeader}
        style={styles.header}
        contentFit="cover"
        contentPosition="bottom"
        accessibilityLabel="Truco Mineiro"
      />
      <LinearGradient
        colors={['rgba(0,34,26,0)', colors.bgTop]}
        style={styles.headerFade}
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
          <View style={styles.spacer} />
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
              onChangeText={(v) => setPhone(formatAsYouType(v, country.code))}
              placeholder={PHONE_PLACEHOLDER[country.code]}
            />
            {error ? (
              <AppText variant="small" color={colors.dangerSoft} style={styles.error}>
                {error}
              </AppText>
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

          <View style={styles.orRow}>
            <View style={styles.line} />
            <AppText variant="small" color={colors.textSecondary}>
              ou
            </AppText>
            <View style={styles.line} />
          </View>

          <Surface style={styles.secure}>
            <Ionicons
              name="shield-checkmark"
              size={26}
              color={colors.cream}
              style={{ marginRight: 12 }}
            />
            <AppText variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
              Seus dados estão protegidos{'\n'}com a tecnologia do Firebase.
            </AppText>
          </Surface>

          <Image source={images.loginCards} style={styles.cards} contentFit="contain" />
          <AppText variant="bodyBold" center style={styles.values}>
            Respeito • Amizade • Boa Resenha
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
            <AppText variant="h3" style={{ marginBottom: 8 }}>
              Escolha o país
            </AppText>
            {COUNTRIES.map((c) => (
              <Pressable
                key={c.code}
                accessibilityRole="button"
                onPress={() => {
                  setCountry(c);
                  setPhone('');
                  setPickerOpen(false);
                }}
                style={styles.countryRow}
              >
                <AppText style={{ fontSize: 20, marginRight: 10 }}>{c.flag}</AppText>
                <AppText variant="body" style={{ flex: 1 }}>
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
                    style={{ marginLeft: 8 }}
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
  header: { position: 'absolute', top: 0, left: 0, right: 0, height: '30%' },
  headerFade: { position: 'absolute', left: 0, right: 0, top: '20%', height: '12%' },
  content: { paddingHorizontal: spacing.screen, flexGrow: 1 },
  spacer: { height: '29%', minHeight: 180 },
  subtitle: { marginTop: 6, fontSize: 15 },
  form: { marginTop: spacing.xl },
  error: { marginTop: 8, marginLeft: 4 },
  cta: { marginTop: spacing.lg },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: spacing.lg },
  line: { flex: 1, height: 1, backgroundColor: colors.divider },
  secure: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  cards: { width: '78%', aspectRatio: 654 / 261, alignSelf: 'center', marginTop: spacing.xl },
  values: { marginTop: spacing.md, fontSize: 15 },
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
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
});
