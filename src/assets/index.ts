import type { AvatarId, LeagueId } from '@/domain/model/types';
import { normalizeLeagueId } from '@/domain/model/leagues';

/**
 * Image registry. All art is cropped from referencia.png (see scripts/extract-assets.py and
 * docs/asset-manifest.md), so characters stay consistent across screens.
 */
export const images = {
  logo: require('../../assets/images/hero/logo.png'),
  introHero: require('../../assets/images/hero/intro_hero.png'),
  loginHeader: require('../../assets/images/hero/login_header.png'),
  loginFooter: require('../../assets/images/hero/login_footer.png'),
  otpTop: require('../../assets/images/hero/otp_top.png'),
  otpBottom: require('../../assets/images/hero/otp_bottom.png'),
  modeIa: require('../../assets/images/cards/mode_ia.png'),
  modeOnline: require('../../assets/images/cards/mode_online.png'),
  bannerAmigos: require('../../assets/images/banners/amigos_turma.png'),
  bannerTemporada: require('../../assets/images/banners/temporada_minas.png'),
} as const;

export const avatarImages: Record<AvatarId, number> = {
  joao: require('../../assets/images/avatars/joao.png'),
  maria: require('../../assets/images/avatars/maria.png'),
  cachorro: require('../../assets/images/avatars/cachorro.png'),
  galo: require('../../assets/images/avatars/galo.png'),
  seu_ze: require('../../assets/images/avatars/seu_ze.png'),
  seu_antonio: require('../../assets/images/avatars/seu_antonio.png'),
  tiao: require('../../assets/images/avatars/tiao.png'),
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
  bronze: require('../../assets/images/icons/shield_bronze.png'),
  silver: require('../../assets/images/icons/shield_silver.png'),
  gold: require('../../assets/images/icons/shield_gold.png'),
  platinum: require('../../assets/images/icons/shield_platinum.png'),
  quartz: require('../../assets/images/icons/shield_quartz.png'),
  topaz: require('../../assets/images/icons/shield_topaz.png'),
  amethyst: require('../../assets/images/icons/shield_amethyst.png'),
  aquamarine: require('../../assets/images/icons/shield_aquamarine.png'),
  tourmaline: require('../../assets/images/icons/shield_tourmaline.png'),
  emerald: require('../../assets/images/icons/shield_emerald.png'),
  sapphire: require('../../assets/images/icons/shield_sapphire.png'),
  ruby: require('../../assets/images/icons/shield_ruby.png'),
  opal: require('../../assets/images/icons/shield_opal.png'),
  onyx: require('../../assets/images/icons/shield_onyx.png'),
  obsidian: require('../../assets/images/icons/shield_obsidian.png'),
  diamond: require('../../assets/images/icons/shield_diamond.png'),
  black_diamond: require('../../assets/images/icons/shield_black_diamond.png'),
  imperial: require('../../assets/images/icons/shield_imperial.png'),
  legendary: require('../../assets/images/icons/shield_legendary.png'),
  legend_of_minas: require('../../assets/images/icons/shield_legend_of_minas.png'),
};

/** Resolve qualquer id (inclusive os antigos em português) para um brasão válido. */
export function leagueShield(id: unknown): number {
  return LEAGUE_SHIELDS[normalizeLeagueId(id)];
}
