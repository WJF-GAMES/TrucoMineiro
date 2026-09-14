import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import {
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaView,
} from 'react-native-google-mobile-ads';
import { colors, radius, spacing } from '@/design-system';
import { AppText } from '@/components';
import { useNativeAd } from '../hooks/useNativeAd';
import type { NativePlacement } from '../types/ads.types';
import { SponsoredBadge } from './SponsoredBadge';

interface Props {
  placement: NativePlacement;
  style?: object;
}

/**
 * Card de Native Ad.
 *
 * Regras de política que o layout precisa respeitar:
 *  - identificação clara ("Patrocinado"), sempre visível e nunca escondida;
 *  - visual de *conteúdo patrocinado*, não de botão do jogo — nada de CTA verde igual ao "JOGAR";
 *  - nunca imita jogador, amigo, ranking, notificação ou evento de temporada;
 *  - se o anúncio não carregar, o componente some (sem espaço vazio, sem loading eterno).
 */
export function NativeAdCard({ placement, style }: Props) {
  const ad = useNativeAd(placement);
  if (!ad) return null;

  const aspectRatio = ad.mediaContent?.aspectRatio;
  const hasMedia = typeof aspectRatio === 'number' && aspectRatio > 0;

  return (
    <View style={[styles.wrap, style]} testID={`native-ad-${placement}`}>
      <NativeAdView nativeAd={ad} style={styles.card}>
        <View style={styles.header}>
          <SponsoredBadge />
          {ad.advertiser ? (
            <AppText
              variant="caption"
              color={colors.textMuted}
              numberOfLines={1}
              style={styles.advertiser}
            >
              {ad.advertiser}
            </AppText>
          ) : null}
        </View>

        <View style={styles.row}>
          {ad.icon?.url ? (
            <NativeAsset assetType={NativeAssetType.ICON}>
              <Image source={{ uri: ad.icon.url }} style={styles.icon} contentFit="cover" />
            </NativeAsset>
          ) : null}
          <View style={styles.texts}>
            <NativeAsset assetType={NativeAssetType.HEADLINE}>
              <AppText variant="bodyBold" numberOfLines={2}>
                {ad.headline}
              </AppText>
            </NativeAsset>
            {ad.body ? (
              <NativeAsset assetType={NativeAssetType.BODY}>
                <AppText
                  variant="small"
                  color={colors.textSecondary}
                  numberOfLines={2}
                  style={styles.body}
                >
                  {ad.body}
                </AppText>
              </NativeAsset>
            ) : null}
          </View>
        </View>

        {hasMedia ? (
          <NativeMediaView style={[styles.media, { aspectRatio }]} resizeMode="cover" />
        ) : null}

        {ad.callToAction ? (
          <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
            <View style={styles.cta}>
              <AppText variant="smallBold" color={colors.textSecondary}>
                {ad.callToAction}
              </AppText>
            </View>
          </NativeAsset>
        ) : null}
      </NativeAdView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Respiro extra em cima e embaixo: o anúncio nunca encosta em botões do app.
  wrap: { marginTop: spacing.xl, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.cardMuted,
    borderRadius: radius.card,
    borderWidth: 1,
    // Borda neutra (não a verde de CTA) para o card não ser confundido com conteúdo do jogo.
    borderColor: colors.divider,
    padding: spacing.cardPadding,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  advertiser: { marginLeft: spacing.sm, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  icon: { width: 44, height: 44, borderRadius: radius.sm, marginRight: spacing.md },
  texts: { flex: 1 },
  body: { marginTop: 2 },
  media: {
    width: '100%',
    marginTop: spacing.md,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.bgDeep,
  },
  cta: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
});
