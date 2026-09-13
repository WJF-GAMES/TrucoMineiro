import type { AvatarId } from '@/domain/model/types';

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
  bannerLoja: require('../../assets/images/banners/loja_personalize.png'),
  bannerTemporada: require('../../assets/images/banners/temporada_minas.png'),
  coinsSmall: require('../../assets/images/icons/coins_small.png'),
  coinsMedium: require('../../assets/images/icons/coins_medium.png'),
  coinsLarge: require('../../assets/images/icons/coins_large.png'),
  coin: require('../../assets/images/icons/coin.png'),
  gem: require('../../assets/images/icons/gem.png'),
  shieldBronze: require('../../assets/images/icons/shield_bronze.png'),
  shieldSilver: require('../../assets/images/icons/shield_silver.png'),
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

export const leagueShield = {
  bronze: images.shieldBronze,
  prata: images.shieldSilver,
  ouro: images.shieldBronze,
  diamante: images.shieldSilver,
} as const;
