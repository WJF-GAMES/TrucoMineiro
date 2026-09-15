import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
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
import { colors, icons, spacing } from '@/design-system';
import { images } from '@/assets';
import { AppText, IconButton, OtpInput, PrimaryButton, Surface } from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { AuthError, confirmCode, signInWithPhoneNumber } from '@/services/firebase/auth';
import { logEvent } from '@/services/firebase/analytics';
import { toast } from '@/stores/toastStore';
import { maskPhone } from '@/utils/phone';
import { OTP_LENGTH } from '@/utils/otp';
import { USE_EMULATORS } from '@/services/firebase/app';
import { haptic } from '@/utils/haptics';
import type { RootScreenProps } from '@/navigation/types';

type Status = 'idle' | 'verifying' | 'invalid' | 'expired' | 'resending';
const RESEND_SECONDS = 45;

/** Proporções naturais das artes recortadas de references/otp.png. */
const TOP_RATIO = 1396 / 780;
const BOTTOM_RATIO = 1396 / 674;

export function OtpScreen({ navigation }: RootScreenProps<'Otp'>) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const pendingPhone = useAuthStore((s) => s.pendingPhone);
  const confirmation = useAuthStore((s) => s.confirmation);
  const setPending = useAuthStore((s) => s.setPending);
  const clearPending = useAuthStore((s) => s.clearPending);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const [resends, setResends] = useState(0);
  const submitting = useRef(false);

  useEffect(() => {
    if (!pendingPhone || !confirmation) navigation.replace('Login');
  }, [pendingPhone, confirmation, navigation]);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const verify = async (value: string) => {
    if (!confirmation || submitting.current) return;
    submitting.current = true;
    setStatus('verifying');
    setMessage(null);
    try {
      await confirmCode(confirmation, value);
      haptic.success();
      logEvent('login_completed');
      clearPending();
      // Auth listener switches the navigator to onboarding/main.
    } catch (e) {
      const err = e instanceof AuthError ? e : null;
      const expired = err?.code === 'code-expired';
      setStatus(expired ? 'expired' : 'invalid');
      setMessage(err?.message ?? 'O código informado não é válido.');
      // Código expirado não serve mais; num código errado o usuário só corrige o dígito.
      if (expired) setCode('');
      haptic.error();
    } finally {
      submitting.current = false;
    }
  };

  const resend = async () => {
    if (!pendingPhone || seconds > 0) return;
    if (resends >= 3) {
      setMessage('Limite de reenvios atingido. Aguarde alguns minutos.');
      return;
    }
    setStatus('resending');
    setCode('');
    try {
      const c = await signInWithPhoneNumber(pendingPhone);
      setPending(pendingPhone, c);
      setResends((r) => r + 1);
      setSeconds(RESEND_SECONDS * (resends + 2));
      setStatus('idle');
      setMessage(null);
      toast.success('Código reenviado');
      logEvent('otp_sent', { resend: true });
    } catch (e) {
      setStatus('idle');
      setMessage(e instanceof AuthError ? e.message : 'Não foi possível reenviar.');
    }
  };

  const waiting = seconds > 0;
  // No mockup a paisagem ocupa ~31% da tela; em telas altas ela cresce até lá (cover corta
  // um pouco das laterais) para o lampião e a placa aparecerem inteiros.
  const naturalTop = width / TOP_RATIO;
  const topHeight = Math.min(Math.max(naturalTop, height * 0.31), naturalTop * 1.3);

  return (
    <View style={styles.root} testID="screen-otp">
      <StatusBar style="light" />
      <Image
        source={images.otpTop}
        style={[styles.top, { height: topHeight }]}
        contentFit="cover"
        contentPosition="top"
        pointerEvents="none"
      />
      <Image
        source={images.otpBottom}
        style={[styles.bottom, { height: width / BOTTOM_RATIO }]}
        contentFit="cover"
        pointerEvents="none"
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + spacing.headerTop, paddingBottom: insets.bottom + 16 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topRow}>
            <IconButton
              icon="chevron-back"
              boxed={false}
              size={28}
              color={colors.text}
              accessibilityLabel="Voltar"
              onPress={() => navigation.goBack()}
            />
            <Image source={images.logo} style={styles.logo} contentFit="contain" />
            <View style={styles.topRowSpacer} />
          </View>

          {/* Título começa sobre a paisagem, como no mockup; a sobra vai toda para baixo. */}
          <View style={{ height: height * 0.06 }} />

          <AppText variant="display" center style={styles.title}>
            Digite o código
          </AppText>
          <AppText variant="body" center color={colors.textSecondary} style={styles.subtitle}>
            Enviamos um SMS com 6 dígitos para{'\n'}
            <AppText variant="bodyBold">{pendingPhone ? maskPhone(pendingPhone) : ''}</AppText>
          </AppText>

          <View style={styles.otp}>
            <OtpInput
              value={code}
              onChange={(v) => {
                setCode(v);
                // Editar limpa a falha anterior para o vermelho não ficar preso na tela.
                if (status === 'invalid' || status === 'expired') {
                  setStatus('idle');
                  setMessage(null);
                }
              }}
              error={status === 'invalid' || status === 'expired'}
            />
          </View>

          {message ? (
            <View style={styles.msgRow}>
              <Ionicons name={icons.alert} size={16} color={colors.dangerSoft} />
              <AppText variant="small" color={colors.dangerSoft} style={styles.msgText}>
                {message}
              </AppText>
            </View>
          ) : (
            <AppText variant="small" center color={colors.textSecondary} style={styles.msg}>
              {status === 'verifying' ? 'Verificando...' : 'O código chega em instantes.'}
            </AppText>
          )}

          <PrimaryButton
            label="Confirmar"
            onPress={() => verify(code)}
            loading={status === 'verifying'}
            disabled={code.length < OTP_LENGTH}
            style={styles.cta}
            testID="otp-confirm"
          />

          <Surface style={styles.resendCard}>
            <View style={styles.resendLeft}>
              <AppText variant="bodyBold">Não recebeu?</AppText>
              <AppText variant="small" color={colors.textSecondary} style={styles.resendHint}>
                {waiting ? 'O SMS pode demorar um pouco.' : 'Você já pode pedir um novo código.'}
              </AppText>
            </View>
            <View style={styles.resendDivider} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reenviar código"
              accessibilityState={{ disabled: waiting || status === 'resending' }}
              disabled={waiting || status === 'resending'}
              onPress={resend}
              hitSlop={8}
              style={styles.resendRight}
            >
              <AppText variant="small" color={colors.textMuted}>
                {waiting ? `Reenviar em ${seconds}s` : 'Novo código'}
              </AppText>
              <AppText
                variant="bodyBold"
                color={waiting ? colors.textMuted : colors.primaryBright}
                style={styles.resendAction}
              >
                {status === 'resending' ? 'Enviando...' : 'Reenviar'}
              </AppText>
            </Pressable>
          </Surface>

          <Pressable
            accessibilityRole="button"
            // Ícone + texto: sem rótulo explícito o leitor de tela lê o conteúdo, e o ícone
            // entra no meio do anúncio. Todas as outras ações desta tela já são rotuladas.
            accessibilityLabel="Alterar telefone"
            accessibilityHint="Volta para informar outro número."
            onPress={() => {
              clearPending();
              navigation.navigate('Login');
            }}
            hitSlop={8}
            style={styles.changePhone}
          >
            <Ionicons name={icons.phone} size={16} color={colors.text} />
            <AppText variant="bodyBold" style={styles.changePhoneText}>
              Alterar telefone
            </AppText>
          </Pressable>

          {USE_EMULATORS ? (
            <AppText variant="caption" center color={colors.gold} style={styles.devHint}>
              Emulator Suite ativo: o código é gerado pelo emulador (veja o log em
              127.0.0.1:4000/auth), não o número de teste do Console.
            </AppText>
          ) : null}

          <View style={styles.spacerBottom} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgTop },
  flex: { flex: 1 },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  content: { paddingHorizontal: spacing.screen, flexGrow: 1 },
  spacerBottom: { flex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topRowSpacer: { width: 28 },
  logo: { width: 130, height: 52 },
  title: {
    marginTop: spacing.lg,
    fontSize: 32,
    lineHeight: 38,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  subtitle: { marginTop: 8, fontSize: 15, lineHeight: 22 },
  otp: { marginTop: spacing.xxl },
  msg: { marginTop: spacing.lg },
  msgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  msgText: { marginLeft: 6 },
  cta: { marginTop: spacing.xl },
  resendCard: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl },
  resendLeft: { flex: 1 },
  resendHint: { marginTop: 2 },
  resendDivider: {
    width: 1,
    alignSelf: 'stretch',
    marginHorizontal: spacing.md,
    backgroundColor: colors.divider,
  },
  resendRight: { alignItems: 'flex-end' },
  resendAction: { marginTop: 2 },
  changePhone: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
    padding: 8,
  },
  changePhoneText: { marginLeft: 8 },
  devHint: { marginTop: spacing.md, paddingHorizontal: spacing.lg },
});
