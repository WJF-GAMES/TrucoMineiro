import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '@/design-system';
import { avatarNames } from '@/assets';
import { AVATAR_IDS, type AvatarId } from '@/domain/model/types';
import { haptic } from '@/utils/haptics';
import { AppText } from './AppText';
import { PlayerAvatar } from './PlayerAvatar';

interface Props {
  value: AvatarId;
  onChange: (id: AvatarId) => void;
  disabled?: boolean;
}

/**
 * Grade de avatares do cadastro e da edição de perfil (um componente só, para não divergirem).
 * A seleção é evidente sem depender só de cor: anel forte, check, fundo realçado e nome em destaque.
 */
export function AvatarPicker({ value, onChange, disabled }: Props) {
  return (
    <View style={styles.grid} accessibilityRole="radiogroup">
      {AVATAR_IDS.map((id) => {
        const selected = id === value;
        return (
          <Pressable
            key={id}
            testID={`avatar-${id}`}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected, disabled }}
            // A build web não traduz `accessibilityState` de radio: o atributo ARIA vai explícito.
            aria-checked={selected}
            accessibilityLabel={avatarNames[id]}
            disabled={disabled}
            onPress={() => {
              if (selected) return;
              haptic.selection();
              onChange(id);
            }}
            style={({ pressed }) => [
              styles.item,
              selected && styles.itemSelected,
              pressed && styles.pressed,
            ]}
          >
            <PlayerAvatar
              avatarId={id}
              size={78}
              ring
              selected={selected}
              ringColor={selected ? colors.primaryBright : 'rgba(120,200,170,0.35)'}
              badge={selected ? 'check' : null}
            />
            <AppText
              variant="caption"
              center
              numberOfLines={1}
              color={selected ? colors.primaryBright : colors.textSecondary}
              style={styles.name}
            >
              {avatarNames[id]}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  item: {
    width: 96,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  itemSelected: {
    backgroundColor: 'rgba(30, 227, 140, 0.14)',
    borderColor: 'rgba(30, 227, 140, 0.45)',
  },
  pressed: { transform: [{ scale: 0.96 }] },
  name: { marginTop: 4, maxWidth: 90 },
});
