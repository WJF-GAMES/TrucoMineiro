import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients, radius, spacing } from '@/design-system';
import { images, avatarNames } from '@/assets';
import {
  AppText,
  Chips,
  GameHeader,
  PillButton,
  PlayerAvatar,
  Screen,
  SectionTitle,
  Surface,
} from '@/components';
import { useProfileStore } from '@/stores/profileStore';
import { purchaseItem, FunctionsError } from '@/services/firebase/functions';
import { logEvent } from '@/services/firebase/analytics';
import { toast } from '@/stores/toastStore';
import { formatCurrencyBRL, formatNumber } from '@/utils/format';
import { STORE_ITEMS, StoreItem } from '@/domain/model/store';
import type { AvatarId } from '@/domain/model/types';
import type { RootScreenProps, StoreTab } from '@/navigation/types';

const TABS: { key: StoreTab; label: string }[] = [
  { key: 'destaques', label: 'Destaques' },
  { key: 'avatares', label: 'Avatares' },
  { key: 'cartas', label: 'Cartas' },
  { key: 'temas', label: 'Temas' },
  { key: 'moedas', label: 'Moedas' },
];

const COIN_PACKS = [
  { id: 'coins_500', coins: 500, priceCents: 490, image: images.coinsSmall, popular: false },
  { id: 'coins_1200', coins: 1200, priceCents: 990, image: images.coinsMedium, popular: true },
  { id: 'coins_2500', coins: 2500, priceCents: 1890, image: images.coinsLarge, popular: false },
];

export function StoreScreen({ route }: RootScreenProps<'Store'>) {
  const [tab, setTab] = useState<StoreTab>(route.params?.tab ?? 'destaques');
  const profile = useProfileStore((s) => s.profile);
  const [busy, setBusy] = useState<string | null>(null);
  const owned = profile?.ownedItems ?? [];

  useEffect(() => {
    logEvent('store_viewed', { tab });
  }, [tab]);

  const buy = async (item: StoreItem) => {
    if (owned.includes(item.id)) return toast.info('Você já tem esse item');
    setBusy(item.id);
    try {
      const r = await purchaseItem(item.id);
      toast.success('Compra realizada!', `Saldo: ${formatNumber(r.coins)} moedas`);
    } catch (e) {
      toast.error('Compra não concluída', e instanceof FunctionsError ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const buyPack = () => {
    toast.info(
      'Pagamentos em breve',
      'A compra de moedas é liberada quando o app for publicado nas lojas.',
    );
  };

  const items = STORE_ITEMS.filter((i) =>
    tab === 'destaques'
      ? i.featured
      : tab === 'avatares'
        ? i.kind === 'avatar'
        : tab === 'cartas'
          ? i.kind === 'deck'
          : tab === 'temas'
            ? i.kind === 'theme'
            : false,
  );

  return (
    <Screen scroll testID="screen-store">
      <GameHeader variant="title" title="Loja" showBack />
      <View style={styles.chips}>
        <Chips<StoreTab> testID="store-tab" options={TABS} value={tab} onChange={setTab} scroll />
      </View>

      {tab === 'destaques' || tab === 'moedas' ? (
        <>
          {tab === 'destaques' ? (
            <View style={styles.banner}>
              <LinearGradient
                colors={gradients.storeBanner}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.bannerText}>
                <AppText variant="h1" style={{ fontSize: 24, lineHeight: 28 }}>
                  Personalize{'\n'}seu jogo!
                </AppText>
                <AppText variant="small" color="rgba(255,255,255,0.9)" style={{ marginTop: 6 }}>
                  Avatares, baralhos e temas para deixar o Truco com a sua cara.
                </AppText>
                <PillButton
                  label="VER TODOS"
                  variant="gold"
                  onPress={() => setTab('avatares')}
                  style={{ marginTop: 12, alignSelf: 'flex-start' }}
                />
              </View>
              <Image
                source={images.bannerLoja}
                style={styles.bannerImage}
                contentFit="cover"
                contentPosition="left"
              />
            </View>
          ) : null}

          <SectionTitle title="Pacotes de Moedas" actionLabel="›" />
          <View style={styles.packs}>
            {COIN_PACKS.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={`${p.coins} moedas por ${formatCurrencyBRL(p.priceCents)}`}
                onPress={buyPack}
                testID={`pack-${p.id}`}
                style={{ flex: 1 }}
              >
                <Surface style={[styles.pack, p.popular ? styles.packPopular : {}]} padding={10}>
                  {p.popular ? (
                    <View style={styles.popular}>
                      <AppText variant="caption" style={{ fontSize: 10 }}>
                        Mais popular
                      </AppText>
                    </View>
                  ) : null}
                  <Image source={p.image} style={styles.packImage} contentFit="contain" />
                  <AppText variant="h2" color={colors.gold}>
                    {formatNumber(p.coins)}
                  </AppText>
                  <AppText variant="smallBold" color={colors.primaryBright}>
                    moedas
                  </AppText>
                  <View style={styles.packDivider} />
                  <AppText variant="small" color={colors.textSecondary}>
                    {formatCurrencyBRL(p.priceCents)}
                  </AppText>
                </Surface>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {tab === 'destaques' ? (
        <>
          <SectionTitle
            title="Avatares em destaque"
            actionLabel="Ver todos"
            onAction={() => setTab('avatares')}
          />
          <View style={styles.avatarRow}>
            {(['joao', 'maria', 'tiao', 'cachorro'] as AvatarId[]).map((id) => (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityLabel={avatarNames[id]}
                onPress={() => setTab('avatares')}
              >
                <PlayerAvatar avatarId={id} size={72} />
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {tab !== 'moedas' ? (
        <>
          {tab !== 'destaques' ? (
            <SectionTitle title={TABS.find((t) => t.key === tab)?.label ?? ''} />
          ) : (
            <SectionTitle title="Ofertas" />
          )}
          <View style={styles.grid}>
            {items.map((item) => {
              const has =
                owned.includes(item.id) ||
                (item.kind === 'avatar' &&
                  item.avatarId === profile?.avatarId &&
                  item.priceCoins === 0);
              return (
                <Surface key={item.id} style={styles.item} padding={10} testID={`item-${item.id}`}>
                  {item.kind === 'avatar' && item.avatarId ? (
                    <View style={styles.itemAvatar}>
                      <PlayerAvatar avatarId={item.avatarId} size={84} />
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.itemSwatch,
                        { backgroundColor: item.color ?? colors.primaryDeep },
                      ]}
                    >
                      <LinearGradient
                        colors={[item.color ?? colors.primary, 'rgba(0,0,0,0.5)']}
                        style={StyleSheet.absoluteFill}
                      />
                    </View>
                  )}
                  <AppText variant="bodyBold" center numberOfLines={1} style={{ marginTop: 8 }}>
                    {item.name}
                  </AppText>
                  <AppText
                    variant="caption"
                    center
                    color={colors.textSecondary}
                    numberOfLines={2}
                    style={styles.itemDescription}
                  >
                    {item.description}
                  </AppText>
                  <View style={styles.priceRow}>
                    {has ? (
                      <PillButton label="Adquirido" variant="muted" disabled />
                    ) : (
                      <PillButton
                        label={
                          item.priceCoins === 0
                            ? 'Grátis'
                            : `${formatNumber(item.priceCoins)} moedas`
                        }
                        onPress={() => buy(item)}
                        disabled={busy === item.id}
                      />
                    )}
                  </View>
                </Surface>
              );
            })}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { marginBottom: spacing.md },
  banner: {
    flexDirection: 'row',
    height: 150,
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.cardBorderStrong,
  },
  bannerText: { flex: 1.1, padding: 14, justifyContent: 'center' },
  bannerImage: { flex: 1, height: '100%' },
  packs: { flexDirection: 'row', gap: 8 },
  pack: { alignItems: 'center', paddingTop: 16, minHeight: 168 },
  packPopular: { borderColor: colors.dangerSoft },
  popular: {
    position: 'absolute',
    top: -10,
    alignSelf: 'center',
    backgroundColor: colors.danger,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  packImage: { width: 64, height: 46, marginBottom: 8 },
  packDivider: { width: '100%', height: 1, backgroundColor: colors.divider, marginVertical: 8 },
  avatarRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  item: { width: '48%', flexGrow: 1, alignItems: 'center' },
  itemDescription: { minHeight: 28 },
  itemAvatar: { alignItems: 'center', paddingVertical: 4 },
  itemSwatch: { width: '100%', aspectRatio: 1.4, borderRadius: radius.md, overflow: 'hidden' },
  priceRow: { marginTop: 8, alignItems: 'center' },
});
