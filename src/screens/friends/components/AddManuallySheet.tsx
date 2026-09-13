import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '@/design-system';
import { AppText, Chips, PrimaryButton, Sheet, TextField } from '@/components';
import { getProfile, searchProfiles } from '@/services/firebase/firestore';
import { FunctionsError, resolveFriendInviteToken } from '@/services/firebase/functions';

type Mode = 'nickname' | 'link';

/**
 * Adicionar manualmente: por apelido ou colando o link/token de convite de alguém.
 *
 * Não existe "adicionar por telefone" aqui de propósito: um campo livre de número seria
 * exatamente o endpoint de enumeração que a funcionalidade de contatos evita (regra 35).
 * Pelo número, o caminho é a agenda — onde só entram pessoas que o usuário já conhece.
 */
export function AddManuallySheet({
  visible,
  onClose,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (uid: string, nickname: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>('nickname');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setValue('');
    setError(null);
  };

  const submit = async () => {
    const term = value.trim();
    if (!term) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'nickname') {
        const found = await searchProfiles(term);
        const exact = found.find((p) => p.nicknameLower === term.toLowerCase()) ?? found[0];
        if (!exact) {
          setError('Ninguém com esse apelido. Confira e tente de novo.');
          return;
        }
        await onAdd(exact.id, exact.nickname);
      } else {
        const token = extractToken(term);
        if (!token) {
          setError('Cole o link completo do convite.');
          return;
        }
        const { uid } = await resolveFriendInviteToken(token);
        // O token não carrega apelido: buscamos o perfil público só para o aviso dizer um nome.
        const target = await getProfile(uid).catch(() => null);
        await onAdd(uid, target?.nickname ?? 'o jogador do convite');
      }
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof FunctionsError ? e.message : 'Não deu certo. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Adicionar manualmente"
      subtitle="Pelo apelido ou pelo link de convite que te mandaram."
      testID="sheet-add-manually"
    >
      <Chips<Mode>
        testID="add-mode"
        options={[
          { key: 'nickname', label: 'Por apelido' },
          { key: 'link', label: 'Por link' },
        ]}
        value={mode}
        onChange={(m) => {
          setMode(m);
          reset();
        }}
      />
      <View style={styles.field}>
        <TextField
          label={mode === 'nickname' ? 'Apelido' : 'Link do convite'}
          placeholder={mode === 'nickname' ? 'JoaoTruco' : 'trucomineiro://add-friend?token=...'}
          value={value}
          onChangeText={(v) => {
            setValue(v);
            setError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={submit}
          error={error}
          testID="add-manually-input"
        />
      </View>
      <AppText variant="small" color={colors.textMuted} style={styles.hint}>
        Para adicionar pelo número, use “Sincronizar contatos”: assim só aparece gente que já
        está na sua agenda.
      </AppText>
      <PrimaryButton
        label="Enviar solicitação"
        size="md"
        loading={busy}
        disabled={!value.trim()}
        onPress={submit}
        style={styles.cta}
        testID="add-manually-submit"
      />
    </Sheet>
  );
}

/** Aceita o link inteiro, só o token, ou o link colado com espaços em volta. */
function extractToken(raw: string): string | null {
  const match = raw.match(/token=([A-Za-z0-9_-]{16,64})/);
  if (match) return match[1]!;
  const bare = raw.trim();
  return /^[A-Za-z0-9_-]{16,64}$/.test(bare) ? bare : null;
}

const styles = StyleSheet.create({
  field: { marginTop: spacing.lg },
  hint: { marginTop: spacing.md, lineHeight: 16 },
  cta: { marginTop: spacing.lg },
});
