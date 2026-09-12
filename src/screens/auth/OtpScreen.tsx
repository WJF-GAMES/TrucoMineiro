import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, spacing } from '@/design-system';
import { images } from '@/assets';
import { AppText, IconButton, OtpInput, PrimaryButton, Screen, Surface } from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { AuthError, confirmCode, signInWithPhoneNumber } from '@/services/firebase/auth';
import { logEvent } from '@/services/firebase/analytics';
import { toast } from '@/stores/toastStore';
import { maskPhone } from '@/utils/phone';
import { USE_EMULATORS } from '@/services/firebase/app';
import { haptic } from '@/utils/haptics';
import type { RootScreenProps } from '@/navigation/types';

type Status = 'idle' | 'verifying' | 'invalid' | 'expired' | 'resending';
const RESEND_SECONDS = 45;

export function OtpScreen({ navigation }: RootScreenProps<'Otp'>) {
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
      setStatus(err?.code === 'code-expired' ? 'expired' : 'invalid');
      setMessage(err?.message ?? 'Código inválido.');
      setCode('');
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

  return (
    <Screen testID="screen-otp">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
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
          <View style={{ width: 28 }} />
        </View>

        <AppText variant="display" center style={styles.title}>
          Digite o código
        </AppText>
        <AppText variant="body" center color={colors.textSecondary}>
          Enviamos um SMS com 6 dígitos para{'\n'}
          <AppText variant="bodyBold">{pendingPhone ? maskPhone(pendingPhone) : ''}</AppText>
        </AppText>

        <View style={styles.otp}>
          <OtpInput
            value={code}
            onChange={(v) => {
              setCode(v);
              // Typing again clears the previous failure so the red state never lingers.
              if (status === 'invalid' || status === 'expired') {
                setStatus('idle');
                setMessage(null);
              }
              if (v.length === 6 && status !== 'verifying') verify(v);
            }}
            error={status === 'invalid' || status === 'expired'}
          />
        </View>

        {message ? (
          <View style={styles.msgRow}>
            <Ionicons name="alert-circle" size={16} color={colors.dangerSoft} />
            <AppText variant="small" color={colors.dangerSoft} style={{ marginLeft: 6 }}>
              {message}
            </AppText>
          </View>
        ) : status === 'verifying' ? (
          <AppText variant="small" center color={colors.textSecondary} style={styles.msg}>
            Verificando...
          </AppText>
        ) : (
          <AppText variant="small" center color={colors.textSecondary} style={styles.msg}>
            O código chega em instantes.
          </AppText>
        )}

        <PrimaryButton
          label="Confirmar"
          onPress={() => verify(code)}
          loading={status === 'verifying'}
          disabled={code.length < 6}
          style={styles.cta}
          testID="otp-confirm"
        />

        <Surface style={styles.resendCard}>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyBold">Não recebeu?</AppText>
            <AppText variant="small" color={colors.textSecondary}>
              {seconds > 0 ? `Reenviar em ${seconds}s` : 'Você já pode pedir um novo código.'}
            </AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reenviar código"
            disabled={seconds > 0 || status === 'resending'}
            onPress={resend}
            hitSlop={8}
          >
            <AppText
              variant="bodyBold"
              color={seconds > 0 ? colors.textMuted : colors.primaryBright}
            >
              {status === 'resending' ? 'Enviando...' : 'Reenviar'}
            </AppText>
          </Pressable>
        </Surface>

        {USE_EMULATORS ? (
          <AppText variant="caption" center color={colors.gold} style={styles.devHint}>
            Emulator Suite ativo: o código é gerado pelo emulador (veja o log em
            127.0.0.1:4000/auth), não o número de teste do Console.
          </AppText>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            clearPending();
            navigation.navigate('Login');
          }}
          style={styles.changePhone}
        >
          <Ionicons name="call" size={16} color={colors.textSecondary} />
          <AppText variant="smallBold" color={colors.textSecondary} style={{ marginLeft: 6 }}>
            Alterar telefone
          </AppText>
        </Pressable>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.headerTop,
  },
  logo: { width: 120, height: 48 },
  title: { marginTop: spacing.xl, marginBottom: 6 },
  otp: { marginTop: spacing.xxl },
  msgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  msg: { marginTop: spacing.md },
  cta: { marginTop: spacing.xl },
  resendCard: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg },
  devHint: { marginTop: spacing.md, paddingHorizontal: spacing.lg },
  changePhone: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
    padding: 8,
  },
});
