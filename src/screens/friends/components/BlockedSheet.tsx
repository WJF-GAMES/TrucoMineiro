import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@/design-system';
import { AppText, PillButton, PlayerAvatar, Sheet, StateView } from '@/components';
import { getProfile } from '@/services/firebase/firestore';
import { FunctionsError, unblockUser } from '@/services/firebase/functions';
import { logEvent } from '@/services/firebase/analytics';
import { toast } from '@/stores/toastStore';
import type { Profile } from '@/domain/model/types';

/**
 * Quem o usuário bloqueou, com o caminho de volta.
 *
 * Bloquear é reversível, então precisa ter onde desfazer: sem esta folha o bloqueio seria uma
 * porta de uma via só. A lista vem de `blocks/{uid}/blocked` (ao vivo, na tela Amigos) e cada
 * linha busca o perfil público para mostrar um nome em vez de um uid.
 */
export function BlockedSheet({
  visible,
  onClose,
  blockedIds,
}: {
  visible: boolean;
  onClose: () => void;
  blockedIds: string[];
}) {
  const [profiles, setProfiles] = useState<Record<string, Profile | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Espelho do que já foi buscado: reabrir a folha não refaz as leituras.
  const fetched = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) return;
    let active = true;
    blockedIds
      .filter((id) => !fetched.current.has(id))
      .forEach((id) => {
        fetched.current.add(id);
        getProfile(id)
          .then((p) => (active ? setProfiles((cur) => ({ ...cur, [id]: p })) : undefined))
          .catch(() => {
            // Perfil apagado ou sem rede: a linha mostra "Jogador" e o desbloqueio continua valendo.
            fetched.current.delete(id);
          });
      });
    return () => {
      active = false;
    };
  }, [visible, blockedIds]);

  const unblock = async (id: string, label: string) => {
    setBusy(id);
    try {
      await unblockUser(id);
      logEvent('friend_unblocked');
      toast.success('Desbloqueado', `${label} pode te encontrar de novo.`);
    } catch (e) {
      toast.error('Não deu certo', e instanceof FunctionsError ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Jogadores bloqueados"
      subtitle="Vocês não aparecem um para o outro nem podem se convidar."
      testID="sheet-blocked"
    >
      {blockedIds.length === 0 ? (
        <StateView
          kind="empty"
          icon="shield-checkmark"
          title="Ninguém bloqueado"
          message="Se precisar, você pode bloquear alguém pela ficha do jogador."
          compact
        />
      ) : (
        <View style={styles.group}>
          {blockedIds.map((id, i) => {
            const profile = profiles[id];
            const label = profile?.nickname ?? 'Jogador';
            return (
              <View
                key={id}
                style={[styles.row, i < blockedIds.length - 1 && styles.divider]}
                testID={`blocked-${id}`}
              >
                <PlayerAvatar avatarId={profile?.avatarId} size={42} ring={false} />
                <View style={styles.texts}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {label}
                  </AppText>
                  <AppText variant="small" color={colors.textMuted}>
                    Bloqueado
                  </AppText>
                </View>
                <PillButton
                  label="Desbloquear"
                  variant="muted"
                  disabled={busy === id}
                  onPress={() => void unblock(id, label)}
                  testID={`unblock-${id}`}
                />
              </View>
            );
          })}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  group: {
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  texts: { flex: 1, marginLeft: 12, marginRight: spacing.sm },
});
