import React, { useState } from 'react';
import { View } from 'react-native';
import { spacing } from '@/design-system';
import {
  AppText,
  AvatarPicker,
  GameHeader,
  PlayerAvatar,
  PrimaryButton,
  Screen,
  TextField,
} from '@/components';
import { useProfileStore } from '@/stores/profileStore';
import type { AvatarId } from '@/domain/model/types';
import { updateProfile, FunctionsError } from '@/services/firebase/functions';
import { NICKNAME_HINT, nicknameSchema } from '@/screens/auth/RegisterScreen';
import { toast } from '@/stores/toastStore';
import { haptic } from '@/utils/haptics';
import type { RootScreenProps } from '@/navigation/types';

export function EditProfileScreen({ navigation }: RootScreenProps<'EditProfile'>) {
  const profile = useProfileStore((s) => s.profile);
  const [nickname, setNickname] = useState(profile?.nickname ?? '');
  const [avatarId, setAvatarId] = useState<AvatarId>(profile?.avatarId ?? 'joao');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const r = nicknameSchema.safeParse(nickname);
    if (!r.success) {
      setError(r.error.issues[0]?.message ?? 'Apelido inválido.');
      return;
    }
    setLoading(true);
    try {
      await updateProfile({ nickname: r.data, avatarId });
      haptic.success();
      toast.success('Perfil atualizado');
      navigation.goBack();
    } catch (e) {
      toast.error('Não foi possível salvar', e instanceof FunctionsError ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll testID="screen-edit-profile">
      <GameHeader variant="title" title="Editar Perfil" showBack />
      <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
        <PlayerAvatar avatarId={avatarId} size={112} />
      </View>
      <TextField
        label="Seu apelido"
        value={nickname}
        onChangeText={setNickname}
        error={error}
        maxLength={16}
        autoCapitalize="words"
        hint={NICKNAME_HINT}
        valid={nicknameSchema.safeParse(nickname).success}
      />
      <AppText variant="h3" style={{ marginTop: spacing.xl, marginBottom: spacing.md }}>
        Escolha seu avatar
      </AppText>
      <AvatarPicker value={avatarId} onChange={setAvatarId} disabled={loading} />
      <PrimaryButton
        label="Salvar"
        onPress={save}
        loading={loading}
        style={{ marginTop: spacing.xxl }}
        testID="edit-save"
      />
    </Screen>
  );
}
