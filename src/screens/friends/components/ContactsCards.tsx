import React from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons } from '@/design-system';
import { AppText } from '@/components';

/**
 * Aviso de privacidade. Discreto de propósito: informa sem competir com a lista (regra 24).
 * O texto é o contrato da funcionalidade — se ele mudar, a implementação precisa mudar junto.
 */
export function ContactsPrivacyNote({ style }: { style?: object }) {
  return (
    <View style={[styles.privacy, style]}>
      <Ionicons name={icons.shield} size={15} color={colors.primaryBright} />
      <AppText variant="small" color={colors.textSecondary} style={styles.privacyText}>
        Seus contatos são usados apenas para encontrar amigos e nunca são compartilhados.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  privacyText: { flex: 1, fontSize: 11.5, lineHeight: 15 },
});
