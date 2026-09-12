import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { colors, spacing } from '@/design-system';
import { AppText, GameHeader, PrimaryButton, Screen, TextField } from '@/components';
import { joinRoom, FunctionsError } from '@/services/firebase/functions';
import { logEvent } from '@/services/firebase/analytics';
import { traced } from '@/services/firebase/perf';
import { haptic } from '@/utils/haptics';
import type { RootScreenProps } from '@/navigation/types';

const ERRORS: Record<string, string> = {
  'not-found': 'Sala não encontrada. Confira o código.',
  'resource-exhausted': 'Essa sala já está cheia.',
  'failed-precondition': 'A partida dessa sala já começou.',
  'invalid-argument': 'Código inválido. Use 6 letras ou números.',
  unavailable: 'Sem conexão. Verifique sua internet.',
};

export function JoinRoomScreen({ navigation }: RootScreenProps<'JoinRoom'>) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);

  const join = async () => {
    if (normalized.length !== 6) {
      setError(ERRORS['invalid-argument']!);
      haptic.error();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await traced('room_join', () => joinRoom(normalized));
      logEvent('room_joined', { via: 'code' });
      haptic.success();
      navigation.replace('Lobby', { code: normalized });
    } catch (e) {
      const c = e instanceof FunctionsError ? e.code : 'unknown';
      setError(
        ERRORS[c] ?? (e instanceof FunctionsError ? e.message : 'Não foi possível entrar na sala.'),
      );
      haptic.error();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen testID="screen-join-room">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <GameHeader variant="title" title="Entrar em Sala" showBack />
        <AppText variant="display" center style={{ marginTop: spacing.lg }}>
          Qual é o código?
        </AppText>
        <AppText variant="body" center color={colors.textSecondary} style={{ marginTop: 6 }}>
          Peça o código de 6 caracteres para quem criou a sala.
        </AppText>
        <TextField
          label="Código da sala"
          placeholder="ABC123"
          value={normalized}
          onChangeText={(v) => {
            setCode(v);
            if (error) setError(null);
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          returnKeyType="go"
          onSubmitEditing={join}
          error={error}
          valid={normalized.length === 6 && !error}
          style={{ marginTop: spacing.xl }}
          testID="room-code-input"
        />
        <PrimaryButton
          label="Entrar na sala"
          onPress={join}
          loading={loading}
          disabled={normalized.length !== 6}
          style={{ marginTop: spacing.lg }}
          testID="room-join"
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({});
export const joinRoomStyles = styles;
