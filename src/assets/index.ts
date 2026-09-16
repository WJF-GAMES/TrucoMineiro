import type { AvatarId, LeagueId } from '@/domain/model/types';
import { normalizeLeagueId } from '@/domain/model/leagues';

/**
 * Image registry. All art is cropped from referencia.png (see scripts/extract-assets.py and
 * docs/asset-manifest.md), so characters stay consistent across screens.
 */
export const images = {
  logo: require('../../assets/images/hero/logo.webp'),
  introHero: require('../../assets/images/hero/intro_hero.webp'),
  loginHeader: require('../../assets/images/hero/login_header.webp'),
  loginFooter: require('../../assets/images/hero/login_footer.webp'),
  otpTop: require('../../assets/images/hero/otp_top.webp'),
  otpBottom: require('../../assets/images/hero/otp_bottom.webp'),
  modeIa: require('../../assets/images/cards/mode_ia.webp'),
  modeOnline: require('../../assets/images/cards/mode_online.webp'),
  bannerAmigos: require('../../assets/images/banners/amigos_turma.webp'),
  bannerTemporada: require('../../assets/images/banners/temporada_minas.webp'),
} as const;

export const avatarImages: Record<AvatarId, number> = {
  joao: require('../../assets/images/avatars/joao.webp'),
  maria: require('../../assets/images/avatars/maria.webp'),
  cachorro: require('../../assets/images/avatars/cachorro.webp'),
  galo: require('../../assets/images/avatars/galo.webp'),
  seu_ze: require('../../assets/images/avatars/seu_ze.webp'),
  seu_antonio: require('../../assets/images/avatars/seu_antonio.webp'),
  tiao: require('../../assets/images/avatars/tiao.webp'),
};

export const avatarNames: Record<AvatarId, string> = {
  joao: 'João da Serra',
  maria: 'Maria Souza',
  cachorro: 'Caramelo',
  galo: 'Galo Carijó',
  seu_ze: 'Seu Zé',
  seu_antonio: 'Seu Antônio',
  tiao: 'Tião',
};

/**
 * Fonte única dos brasões das 20 ligas. A chave é o `LeagueId` do backend; o Firestore guarda só
 * `assetKey` ("shield_gold") e nunca um caminho local. Os arquivos já existem em
 * `assets/images/icons/` — não gerar arte nova nem substituir os brasões.
 */
export const LEAGUE_SHIELDS: Record<LeagueId, number> = {
  bronze: require('../../assets/images/icons/shield_bronze.webp'),
  silver: require('../../assets/images/icons/shield_silver.webp'),
  gold: require('../../assets/images/icons/shield_gold.webp'),
  platinum: require('../../assets/images/icons/shield_platinum.webp'),
  quartz: require('../../assets/images/icons/shield_quartz.webp'),
  topaz: require('../../assets/images/icons/shield_topaz.webp'),
  amethyst: require('../../assets/images/icons/shield_amethyst.webp'),
  aquamarine: require('../../assets/images/icons/shield_aquamarine.webp'),
  tourmaline: require('../../assets/images/icons/shield_tourmaline.webp'),
  emerald: require('../../assets/images/icons/shield_emerald.webp'),
  sapphire: require('../../assets/images/icons/shield_sapphire.webp'),
  ruby: require('../../assets/images/icons/shield_ruby.webp'),
  opal: require('../../assets/images/icons/shield_opal.webp'),
  onyx: require('../../assets/images/icons/shield_onyx.webp'),
  obsidian: require('../../assets/images/icons/shield_obsidian.webp'),
  diamond: require('../../assets/images/icons/shield_diamond.webp'),
  black_diamond: require('../../assets/images/icons/shield_black_diamond.webp'),
  imperial: require('../../assets/images/icons/shield_imperial.webp'),
  legendary: require('../../assets/images/icons/shield_legendary.webp'),
  legend_of_minas: require('../../assets/images/icons/shield_legend_of_minas.webp'),
};

/** Resolve qualquer id (inclusive os antigos em português) para um brasão válido. */
export function leagueShield(id: unknown): number {
  return LEAGUE_SHIELDS[normalizeLeagueId(id)];
}
