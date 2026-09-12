import type { AvatarId } from './types';

export interface StoreItem {
  id: string;
  kind: 'avatar' | 'deck' | 'theme';
  name: string;
  description: string;
  priceCoins: number;
  featured: boolean;
  avatarId?: AvatarId;
  color?: string;
}

/** Catalog shared by app and Functions (prices are validated server-side). */
export const STORE_ITEMS: StoreItem[] = [
  {
    id: 'avatar_joao',
    kind: 'avatar',
    name: 'João da Serra',
    description: 'O trucador raiz de Minas.',
    priceCoins: 0,
    featured: true,
    avatarId: 'joao',
  },
  {
    id: 'avatar_maria',
    kind: 'avatar',
    name: 'Maria Souza',
    description: 'Sorriso largo e mão firme.',
    priceCoins: 0,
    featured: true,
    avatarId: 'maria',
  },
  {
    id: 'avatar_tiao',
    kind: 'avatar',
    name: 'Tião',
    description: 'Óculos escuros e blefe na manga.',
    priceCoins: 350,
    featured: true,
    avatarId: 'tiao',
  },
  {
    id: 'avatar_cachorro',
    kind: 'avatar',
    name: 'Caramelo',
    description: 'O parceiro mais fiel da mesa.',
    priceCoins: 250,
    featured: true,
    avatarId: 'cachorro',
  },
  {
    id: 'avatar_galo',
    kind: 'avatar',
    name: 'Galo Carijó',
    description: 'Canta alto quando pede truco.',
    priceCoins: 400,
    featured: false,
    avatarId: 'galo',
  },
  {
    id: 'avatar_seu_ze',
    kind: 'avatar',
    name: 'Seu Zé',
    description: 'Experiência de venda de esquina.',
    priceCoins: 300,
    featured: false,
    avatarId: 'seu_ze',
  },
  {
    id: 'avatar_seu_antonio',
    kind: 'avatar',
    name: 'Seu Antônio',
    description: 'Calmo, até virar o Zap.',
    priceCoins: 300,
    featured: false,
    avatarId: 'seu_antonio',
  },
  {
    id: 'deck_classico',
    kind: 'deck',
    name: 'Baralho Clássico',
    description: 'O vermelho tradicional da mesa.',
    priceCoins: 0,
    featured: false,
    color: '#b0122a',
  },
  {
    id: 'deck_ouro',
    kind: 'deck',
    name: 'Baralho Dourado',
    description: 'Verso dourado para quem manda.',
    priceCoins: 800,
    featured: true,
    color: '#c9971b',
  },
  {
    id: 'deck_esmeralda',
    kind: 'deck',
    name: 'Baralho Esmeralda',
    description: 'Verde Minas com detalhes em creme.',
    priceCoins: 600,
    featured: false,
    color: '#0f7a4c',
  },
  {
    id: 'theme_classico',
    kind: 'theme',
    name: 'Mesa Clássica',
    description: 'Feltro verde, luz de venda.',
    priceCoins: 0,
    featured: false,
    color: '#0d4a3a',
  },
  {
    id: 'theme_noite',
    kind: 'theme',
    name: 'Mesa Noite de Serra',
    description: 'Azul profundo com estrelas.',
    priceCoins: 900,
    featured: true,
    color: '#0b2a5c',
  },
  {
    id: 'theme_fazenda',
    kind: 'theme',
    name: 'Mesa da Fazenda',
    description: 'Madeira e sol de fim de tarde.',
    priceCoins: 700,
    featured: false,
    color: '#7a4a12',
  },
];

export function storeItemById(id: string): StoreItem | undefined {
  return STORE_ITEMS.find((i) => i.id === id);
}
