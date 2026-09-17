import type { LeagueDefinition, LeagueId } from './types';

/**
 * Escada oficial das 20 ligas, na ordem definitiva do produto.
 *
 * Os ids são estáveis em inglês (nunca mudam, são chave no banco e no mapa de assets);
 * o nome exibido é em português. `assetKey` aponta para `assets/images/icons/<assetKey>.webp` —
 * o caminho local NUNCA é gravado no banco, só a chave.
 */
const LADDER: { id: LeagueId; displayName: string }[] = [
  { id: 'bronze', displayName: 'Bronze' },
  { id: 'silver', displayName: 'Prata' },
  { id: 'gold', displayName: 'Ouro' },
  { id: 'platinum', displayName: 'Platina' },
  { id: 'quartz', displayName: 'Quartzo' },
  { id: 'topaz', displayName: 'Topázio' },
  { id: 'amethyst', displayName: 'Ametista' },
  { id: 'aquamarine', displayName: 'Água-marinha' },
  { id: 'tourmaline', displayName: 'Turmalina' },
  { id: 'emerald', displayName: 'Esmeralda' },
  { id: 'sapphire', displayName: 'Safira' },
  { id: 'ruby', displayName: 'Rubi' },
  { id: 'opal', displayName: 'Opala' },
  { id: 'onyx', displayName: 'Ônix' },
  { id: 'obsidian', displayName: 'Obsidiana' },
  { id: 'diamond', displayName: 'Diamante' },
  { id: 'black_diamond', displayName: 'Diamante Negro' },
  { id: 'imperial', displayName: 'Imperial' },
  { id: 'legendary', displayName: 'Lendária' },
  { id: 'legend_of_minas', displayName: 'Lenda de Minas' },
];

export const LEAGUE_IDS: LeagueId[] = LADDER.map((l) => l.id);

export const FIRST_LEAGUE_ID: LeagueId = 'bronze';
export const LAST_LEAGUE_ID: LeagueId = 'legend_of_minas';

/** Liga onde todo jogador novo começa (MVP: sem partidas de posicionamento). */
export const STARTING_LEAGUE_ID: LeagueId = FIRST_LEAGUE_ID;

export const LEAGUE_DEFINITIONS: LeagueDefinition[] = LADDER.map((l, i) => ({
  id: l.id,
  order: i + 1,
  displayName: l.displayName,
  assetKey: `shield_${l.id}`,
  previousLeagueId: i === 0 ? null : LADDER[i - 1]!.id,
  nextLeagueId: i === LADDER.length - 1 ? null : LADDER[i + 1]!.id,
  isFirst: i === 0,
  isLast: i === LADDER.length - 1,
  active: true,
}));

const BY_ID = new Map<LeagueId, LeagueDefinition>(LEAGUE_DEFINITIONS.map((l) => [l.id, l]));

/** Nomes exibidos, por id. */
export const LEAGUE_NAMES = LEAGUE_DEFINITIONS.reduce(
  (acc, l) => {
    acc[l.id] = l.displayName;
    return acc;
  },
  {} as Record<LeagueId, string>,
);

/**
 * Ids usados antes do sistema semanal de 20 ligas (4 ligas em português).
 * Perfis antigos são normalizados na leitura para não quebrarem a tela nem o brasão.
 */
const LEGACY_IDS: Record<string, LeagueId> = {
  bronze: 'bronze',
  prata: 'silver',
  ouro: 'gold',
  diamante: 'diamond',
};

export function isLeagueId(value: unknown): value is LeagueId {
  return typeof value === 'string' && BY_ID.has(value as LeagueId);
}

/** Sempre devolve uma liga válida — nunca `undefined`, nunca quebra a UI. */
export function normalizeLeagueId(value: unknown): LeagueId {
  if (isLeagueId(value)) return value;
  if (typeof value === 'string' && LEGACY_IDS[value]) return LEGACY_IDS[value]!;
  return STARTING_LEAGUE_ID;
}

export function leagueById(id: unknown): LeagueDefinition {
  return BY_ID.get(normalizeLeagueId(id))!;
}

export function leagueByOrder(order: number): LeagueDefinition | null {
  return LEAGUE_DEFINITIONS[order - 1] ?? null;
}

/** Próxima liga da escada. No topo (Lenda de Minas) o jogador permanece. */
export function promotedLeagueId(id: LeagueId): LeagueId {
  return leagueById(id).nextLeagueId ?? id;
}

/** Liga anterior da escada. No piso (Bronze) o jogador permanece. */
export function relegatedLeagueId(id: LeagueId): LeagueId {
  return leagueById(id).previousLeagueId ?? id;
}

export function leagueAssetKey(id: unknown): string {
  return leagueById(id).assetKey;
}
