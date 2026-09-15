import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons, spacing } from '@/design-system';
import { AppText, PillButton, PlayerAvatar } from '@/components';
import { initialsOf } from '@/utils/phone';
import type { FriendRequest, PresenceState, RoomInvite } from '@/domain/model/types';
import type { MatchedContact, UnmatchedContact } from '@/features/friends/contactsMatch';
import type { FriendEntry } from '@/features/friends/useFriends';

const STATUS_LABEL: Record<PresenceState, string> = {
  online: 'Online',
  in_match: 'Na partida',
  offline: 'Offline',
};
const STATUS_COLOR: Record<PresenceState, string> = {
  online: colors.online,
  in_match: colors.away,
  offline: colors.offline,
};

/** Casca comum das linhas: mesma altura, mesmo divisor, mesmo espaçamento. */
function Row({
  children,
  divider = true,
  testID,
}: {
  children: React.ReactNode;
  divider?: boolean;
  testID?: string;
}) {
  return (
    <View style={[styles.row, divider && styles.divider]} testID={testID}>
      {children}
    </View>
  );
}

/**
 * Linha com duas ações (aceitar/recusar). Os dois pills somam ~180dp; com o avatar e os
 * respiros, sobravam menos de 70dp para o nome num aparelho de 360dp — todo apelido virava
 * reticências. Aqui identidade e ações ficam em linhas próprias: o nome usa a largura inteira
 * e os botões continuam com o rótulo escrito (regras 12 e 13).
 */
function StackedRow({
  children,
  actions,
  divider = true,
  testID,
}: {
  children: React.ReactNode;
  actions: React.ReactNode;
  divider?: boolean;
  testID?: string;
}) {
  return (
    <View style={[styles.stacked, divider && styles.divider]} testID={testID}>
      <View style={styles.stackedIdentity}>{children}</View>
      <View style={styles.stackedActions}>{actions}</View>
    </View>
  );
}

/** Avatar de quem ainda não joga: iniciais do nome da agenda, nunca uma foto do contato. */
export function ContactInitials({ name, size = 46 }: { name: string; size?: number }) {
  return (
    <View style={[styles.initials, { width: size, height: size, borderRadius: size / 2 }]}>
      <AppText variant="h3" color={colors.textSecondary} style={{ fontSize: size * 0.34 }}>
        {initialsOf(name)}
      </AppText>
    </View>
  );
}

// --- Amigo -------------------------------------------------------------------

export const FriendRow = memo(function FriendRow({
  entry,
  busy,
  divider,
  onPlay,
  onOpen,
}: {
  entry: FriendEntry;
  busy: boolean;
  divider: boolean;
  onPlay: (uid: string) => void;
  onOpen: (uid: string) => void;
}) {
  const { profile, presence } = entry;
  const state = presence?.state ?? 'offline';
  return (
    <Row divider={divider} testID={`friend-${profile.id}`}>
      {/* A linha inteira abre a ficha do amigo; o pill continua sendo o caminho curto para jogar. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ver ${profile.nickname}`}
        onPress={() => onOpen(profile.id)}
        style={styles.identity}
        testID={`friend-open-${profile.id}`}
      >
        <PlayerAvatar avatarId={profile.avatarId} size={46} status={state} />
        <View style={styles.texts}>
          <AppText variant="h3" numberOfLines={1} style={styles.name}>
            {profile.nickname}
          </AppText>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: STATUS_COLOR[state] }]} />
            <AppText
              variant="small"
              color={state === 'online' ? colors.online : colors.textSecondary}
            >
              {STATUS_LABEL[state]}
            </AppText>
          </View>
        </View>
      </Pressable>
      {/* Em partida também vale convidar: o convite espera o amigo terminar (não existe assistir). */}
      <PillButton
        label={state === 'online' ? 'Jogar' : 'Convidar'}
        variant={state === 'online' ? 'primary' : 'muted'}
        onPress={() => onPlay(profile.id)}
        disabled={busy}
        testID={`friend-play-${profile.id}`}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Mais opções de ${profile.nickname}`}
        hitSlop={8}
        onPress={() => onOpen(profile.id)}
        style={styles.more}
        testID={`friend-more-${profile.id}`}
      >
        <Ionicons name={icons.more} size={20} color={colors.textSecondary} />
      </Pressable>
    </Row>
  );
});

// --- Convite de sala recebido ------------------------------------------------

export const RoomInviteRow = memo(function RoomInviteRow({
  invite,
  busy,
  divider,
  onAccept,
  onDecline,
}: {
  invite: RoomInvite;
  busy: boolean;
  divider: boolean;
  onAccept: (invite: RoomInvite) => void;
  onDecline: (invite: RoomInvite) => void;
}) {
  return (
    <StackedRow
      divider={divider}
      testID={`room-invite-${invite.code}`}
      actions={
        <>
          <PillButton
            label="Recusar"
            variant="muted"
            disabled={busy}
            onPress={() => onDecline(invite)}
            style={styles.stackedPill}
            testID={`room-invite-decline-${invite.code}`}
          />
          <PillButton
            label="Entrar"
            variant="gold"
            disabled={busy}
            onPress={() => onAccept(invite)}
            style={styles.stackedPill}
            testID={`room-invite-accept-${invite.code}`}
          />
        </>
      }
    >
      <View style={styles.inviteIcon}>
        <Ionicons name={icons.gameController} size={22} color={colors.gold} />
      </View>
      <View style={styles.texts}>
        <AppText variant="h3" numberOfLines={1} style={styles.name}>
          {invite.fromNickname}
        </AppText>
        <AppText variant="small" color={colors.textSecondary} numberOfLines={1}>
          te chamou para a sala {invite.code}
        </AppText>
      </View>
    </StackedRow>
  );
});

// --- Solicitação -------------------------------------------------------------

export const FriendRequestRow = memo(function FriendRequestRow({
  request,
  direction,
  busy,
  divider,
  onAccept,
  onReject,
  onCancel,
}: {
  request: FriendRequest;
  direction: 'incoming' | 'outgoing';
  busy: boolean;
  divider: boolean;
  onAccept: (r: FriendRequest) => void;
  onReject: (r: FriendRequest) => void;
  onCancel: (r: FriendRequest) => void;
}) {
  const incoming = direction === 'incoming';
  const identity = (
    <>
      <PlayerAvatar
        avatarId={incoming ? request.fromAvatarId : (request.toAvatarId ?? 'joao')}
        size={46}
      />
      <View style={styles.texts}>
        <AppText variant="h3" numberOfLines={1} style={styles.name}>
          {incoming ? request.fromNickname : (request.toNickname ?? 'Jogador')}
        </AppText>
        <AppText variant="small" color={colors.textSecondary} numberOfLines={1}>
          {incoming ? 'quer ser seu amigo' : 'aguardando resposta'}
        </AppText>
      </View>
    </>
  );

  // Enviada: uma ação só, cabe na mesma linha do nome.
  if (!incoming) {
    return (
      <Row divider={divider} testID={`request-${request.id}`}>
        {identity}
        <PillButton
          label="Cancelar"
          variant="muted"
          onPress={() => onCancel(request)}
          disabled={busy}
          testID={`request-cancel-${request.id}`}
        />
      </Row>
    );
  }

  return (
    <StackedRow
      divider={divider}
      testID={`request-${request.id}`}
      actions={
        <>
          <PillButton
            label="Recusar"
            variant="muted"
            onPress={() => onReject(request)}
            disabled={busy}
            style={styles.stackedPill}
            testID={`request-reject-${request.id}`}
          />
          <PillButton
            label="Aceitar"
            onPress={() => onAccept(request)}
            disabled={busy}
            style={styles.stackedPill}
            testID={`request-accept-${request.id}`}
          />
        </>
      }
    >
      {identity}
    </StackedRow>
  );
});

// --- Contato da agenda que já joga -------------------------------------------

const RELATION_PILL = {
  none: { label: 'Adicionar', variant: 'primary' as const, disabled: false },
  request_sent: { label: 'Enviado', variant: 'muted' as const, disabled: true },
  request_received: { label: 'Aceitar', variant: 'gold' as const, disabled: false },
  friend: { label: 'Amigo', variant: 'muted' as const, disabled: true },
  self: { label: 'Você', variant: 'muted' as const, disabled: true },
};

export const ContactMatchRow = memo(function ContactMatchRow({
  contact,
  busy,
  divider,
  onAdd,
}: {
  contact: MatchedContact;
  busy: boolean;
  divider: boolean;
  onAdd: (contact: MatchedContact) => void;
}) {
  const pill = RELATION_PILL[contact.relation];
  return (
    <Row divider={divider} testID={`contact-match-${contact.contactId}`}>
      <PlayerAvatar avatarId={contact.avatarId} size={46} />
      <View style={styles.texts}>
        {/* Nome da agenda em primeiro: é assim que o usuário reconhece a pessoa (regra 58). */}
        <AppText variant="h3" numberOfLines={1} style={styles.name}>
          {contact.contactName}
        </AppText>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: colors.online }]} />
          <AppText variant="small" color={colors.textSecondary} numberOfLines={1}>
            Já joga · @{contact.nickname}
          </AppText>
        </View>
      </View>
      <PillButton
        label={pill.label}
        variant={pill.variant}
        disabled={pill.disabled || busy}
        onPress={() => onAdd(contact)}
        testID={`contact-add-${contact.contactId}`}
      />
    </Row>
  );
});

// --- Contato da agenda que ainda não joga ------------------------------------

export const InviteContactRow = memo(function InviteContactRow({
  contact,
  divider,
  onInvite,
}: {
  contact: UnmatchedContact;
  divider: boolean;
  onInvite: (contact: UnmatchedContact) => void;
}) {
  return (
    <Row divider={divider} testID={`contact-invite-${contact.contactId}`}>
      <ContactInitials name={contact.contactName} />
      <View style={styles.texts}>
        <AppText variant="h3" numberOfLines={1} style={styles.name}>
          {contact.contactName}
        </AppText>
        {/* Sem telefone, nem mascarado: a linha não precisa dele para ninguém se reconhecer. */}
        <AppText variant="small" color={colors.textMuted} numberOfLines={1}>
          Ainda não joga · convide para a resenha
        </AppText>
      </View>
      <PillButton
        label="Convidar"
        variant="muted"
        onPress={() => onInvite(contact)}
        testID={`contact-invite-btn-${contact.contactId}`}
      />
    </Row>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 66,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  texts: { flex: 1, marginLeft: 12, marginRight: spacing.sm },
  inviteIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(4, 21, 23, 0.65)',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  name: { fontSize: 15.5 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  more: { paddingLeft: 8, paddingVertical: 6 },
  stacked: { paddingHorizontal: 10, paddingVertical: 10 },
  stackedIdentity: { flexDirection: 'row', alignItems: 'center' },
  // Ações alinhadas à direita, a secundária primeiro: aceitar fica na quina do polegar.
  stackedActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  stackedPill: { flexShrink: 1 },
  initials: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(4, 21, 23, 0.65)',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
});
