import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';
import { colors, spacing } from '@/design-system';
import { images, avatarNames } from '@/assets';
import { AppText, IconButton, PlayerAvatar, PrimaryButton, Screen, TextField } from '@/components';
import { AVATAR_IDS, AvatarId } from '@/domain/model/types';
import { updateProfile, FunctionsError } from '@/services/firebase/functions';
import { signOut } from '@/services/firebase/auth';
import { useAuthStore } from '@/stores/authStore';
import { logEvent } from '@/services/firebase/analytics';
import { toast } from '@/stores/toastStore';
import { haptic } from '@/utils/haptics';
import type { RootNavigation } from '@/navigation/types';
import { useNavigation } from '@react-navigation/native';

export const nicknameSchema = z
  .string()
  .trim()
  .min(3, 'Use pelo menos 3 caracteres.')
  .max(16, 'Use no máximo 16 caracteres.')
  .regex(/^[\p{L}\p{N} _.-]+$/u, 'Use apenas letras, números e espaços.');

export function RegisterScreen() {
  const navigation = useNavigation<RootNavigation>();
  const insets = useSafeAreaInsets();
  const [nickname, setNickname] = useState('');
  const [avatarId, setAvatarId] = useState<AvatarId>('joao');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setOnboarded = useAuthStore((s) => s.setOnboarded);

  const parsed = nicknameSchema.safeParse(nickname);
  const valid = parsed.success;

  const submit = async () => {
    const result = nicknameSchema.safeParse(nickname);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Apelido inválido.');
      haptic.error();
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await updateProfile({ nickname: result.data, avatarId });
      logEvent('profile_created', { avatar: avatarId });
      haptic.success();
      setOnboarded();
    } catch (e) {
      const msg = e instanceof FunctionsError ? e.message : 'Não foi possível criar a conta.';
      setError(msg);
      toast.error('Ops', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen testID="screen-register" padded={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 16 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topRow}>
            <IconButton
              icon="chevron-back"
              boxed={false}
              size={28}
              color={colors.text}
              accessibilityLabel="Sair"
              onPress={() => signOut()}
            />
            <Image source={images.logo} style={styles.logo} contentFit="contain" />
            <View style={{ width: 28 }} />
          </View>

          <AppText variant="display" center style={styles.title}>
            Quase lá!
          </AppText>
          <AppText variant="body" center color={colors.textSecondary}>
            Como você quer ser chamado?
          </AppText>

          <TextField
            label="Seu apelido"
            placeholder="João da Serra"
            value={nickname}
            onChangeText={(v) => {
              setNickname(v);
              if (error) setError(null);
            }}
            valid={valid}
            error={error}
            hint="Você poderá alterar depois."
            maxLength={16}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            style={styles.field}
            testID="nickname-input"
          />

          <AppText variant="h3" style={styles.section}>
            Escolha seu avatar
          </AppText>
          <View style={styles.avatars}>
            {AVATAR_IDS.map((id) => (
              <Pressable
                key={id}
                testID={`avatar-${id}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: id === avatarId }}
                accessibilityLabel={avatarNames[id]}
                onPress={() => {
                  haptic.selection();
                  setAvatarId(id);
                }}
                style={styles.avatarWrap}
              >
                <PlayerAvatar
                  avatarId={id}
                  size={78}
                  ring
                  ringColor={id === avatarId ? colors.primaryBright : 'rgba(120,200,170,0.35)'}
                  badge={id === avatarId ? 'check' : null}
                />
              </Pressable>
            ))}
          </View>

          <View style={styles.flexSpacer} />
          <AppText variant="h2">Vamos nessa?</AppText>
          <AppText variant="small" color={colors.textSecondary} style={styles.terms}>
            Ao continuar, você concorda com nossos{' '}
            <AppText
              variant="smallBold"
              style={styles.link}
              onPress={() => navigation.navigate('StaticPage', { kind: 'terms' })}
            >
              Termos de Uso
            </AppText>{' '}
            e{' '}
            <AppText
              variant="smallBold"
              style={styles.link}
              onPress={() => navigation.navigate('StaticPage', { kind: 'privacy' })}
            >
              Política de Privacidade
            </AppText>
            .
          </AppText>
          <PrimaryButton
            label="Criar conta"
            onPress={submit}
            loading={loading}
            disabled={!valid}
            style={styles.cta}
            testID="register-submit"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: spacing.screen },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.headerTop,
  },
  logo: { width: 120, height: 48 },
  title: { marginTop: spacing.md, marginBottom: 4 },
  field: { marginTop: spacing.xl },
  section: { marginTop: spacing.xl, marginBottom: spacing.md },
  avatars: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  avatarWrap: { padding: 2 },
  flexSpacer: { flex: 1, minHeight: spacing.xl },
  terms: { marginTop: 6, lineHeight: 18 },
  link: { textDecorationLine: 'underline', color: colors.text },
  cta: { marginTop: spacing.lg },
});
