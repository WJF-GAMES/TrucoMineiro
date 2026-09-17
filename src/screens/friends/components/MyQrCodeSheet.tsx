import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { colors, radius, spacing } from '@/design-system';
import { AppText, SecondaryButton, Sheet, StateView } from '@/components';
import { createFriendInviteToken, ApiError } from '@/services/api';
import { logEvent } from '@/services/firebase/analytics';
import { toast } from '@/stores/toastStore';
import type { FriendInviteToken } from '@/domain/model/types';

/**
 * QR Code do usuário.
 *
 * O código contém só um token opaco e expirável (`trucomineiro://add-friend?token=...`):
 * nunca o telefone e nem o uid interno. Quem ler o QR precisa chamar o backend para
 * transformá-lo em solicitação, então um print do QR não expõe dado nenhum do perfil.
 */
export function MyQrCodeSheet({
  visible,
  onClose,
  nickname,
}: {
  visible: boolean;
  onClose: () => void;
  nickname: string;
}) {
  const [invite, setInvite] = useState<FriendInviteToken | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Limpa o erro da abertura anterior durante a renderização, não dentro do efeito.
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) setError(null);
  }

  useEffect(() => {
    if (!visible) return;
    let active = true;
    logEvent('friend_qr_opened');
    createFriendInviteToken()
      .then((i) => {
        if (!active) return;
        // Sem link não existe QR: melhor o estado de erro do que um código ilegível.
        if (!i?.link) setError('Não foi possível gerar o código. Tente de novo.');
        else setInvite(i);
      })
      .catch((e) =>
        active
          ? setError(e instanceof ApiError ? e.message : 'Não foi possível gerar o código.')
          : undefined,
      );
    return () => {
      active = false;
    };
  }, [visible]);

  const share = async () => {
    if (!invite) return;
    await Share.share({
      message: `Bora jogar Truco Mineiro comigo? Me adiciona por aqui: ${invite.link}`,
    });
    logEvent('friend_invite_shared', { source: 'qr' });
  };

  const copy = async () => {
    if (!invite) return;
    await Clipboard.setStringAsync(invite.link);
    toast.success('Link copiado');
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Meu QR Code"
      subtitle="Mostre para alguém escanear e virar seu amigo na hora."
      testID="sheet-qr"
    >
      {error ? (
        <StateView kind="error" message={error} compact />
      ) : !invite ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <>
          <View style={styles.qrCard}>
            {/* Fundo claro fixo: leitores de QR precisam de contraste real, não do tema escuro. */}
            <View style={styles.qrBox}>
              <QRCode value={invite.link} size={200} backgroundColor="#ffffff" color="#02100d" />
            </View>
            {nickname ? (
              <AppText variant="h3" center style={styles.nick}>
                @{nickname}
              </AppText>
            ) : null}
            <AppText variant="small" center color={colors.textSecondary}>
              O código não contém seu telefone e expira em 30 dias.
            </AppText>
          </View>
          <SecondaryButton
            label="Compartilhar link"
            icon="share-social"
            onPress={share}
            style={styles.action}
            testID="qr-share"
          />
          <SecondaryButton label="Copiar link" icon="copy" onPress={copy} style={styles.action} />
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: spacing.xxxl },
  qrCard: {
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  qrBox: { padding: 14, borderRadius: radius.md, backgroundColor: '#ffffff' },
  nick: { marginTop: spacing.md },
  action: { marginTop: spacing.md },
});
