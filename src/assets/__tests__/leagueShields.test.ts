import fs from 'fs';
import path from 'path';
import { LEAGUE_SHIELDS, leagueShield } from '../index';
import { LEAGUE_DEFINITIONS, LEAGUE_IDS } from '@/domain/model/leagues';

/**
 * Os brasões das 20 ligas já existem no projeto (`assets/images/icons`). Estes testes garantem que
 * o mapa cobre todas as ligas, que cada chave aponta para o arquivo certo e que nenhuma liga cai
 * num placeholder — quebra de brasão é o tipo de erro que só aparece no dispositivo.
 */

const ICONS_DIR = path.resolve(__dirname, '../../../assets/images/icons');

describe('LEAGUE_SHIELDS', () => {
  it('cobre exatamente as 20 ligas', () => {
    expect(Object.keys(LEAGUE_SHIELDS).sort()).toEqual([...LEAGUE_IDS].sort());
    expect(Object.keys(LEAGUE_SHIELDS)).toHaveLength(20);
  });

  it('resolve um asset para cada liga, sem repetir brasão entre ligas', () => {
    const sources = LEAGUE_IDS.map((id) => LEAGUE_SHIELDS[id]);
    sources.forEach((source, i) => {
      expect(source).toBeDefined();
      expect(source).not.toBeNull();
      // Fora do bundler, `require` de imagem devolve um número (ou objeto) — nunca undefined.
      expect(['number', 'object']).toContain(typeof source);
      expect(source).toBe(leagueShield(LEAGUE_IDS[i]));
    });
    expect(new Set(sources).size).toBe(20);
  });

  it('tem o arquivo real de cada assetKey no disco', () => {
    for (const league of LEAGUE_DEFINITIONS) {
      const file = path.join(ICONS_DIR, `${league.assetKey}.png`);
      expect({ league: league.id, exists: fs.existsSync(file) }).toEqual({
        league: league.id,
        exists: true,
      });
      expect(fs.statSync(file).size).toBeGreaterThan(0);
    }
  });

  it('não expõe assets de moeda/gema (não existem mais no produto)', () => {
    const naoSaoLigas = ['coin', 'coins_small', 'coins_medium', 'coins_large', 'gem'];
    for (const league of LEAGUE_DEFINITIONS) {
      expect(naoSaoLigas).not.toContain(league.assetKey);
      expect(league.assetKey.startsWith('shield_')).toBe(true);
    }
  });
});

describe('leagueShield', () => {
  it('aceita os ids antigos em português', () => {
    expect(leagueShield('prata')).toBe(LEAGUE_SHIELDS.silver);
    expect(leagueShield('ouro')).toBe(LEAGUE_SHIELDS.gold);
    expect(leagueShield('diamante')).toBe(LEAGUE_SHIELDS.diamond);
  });

  it('nunca devolve vazio, mesmo com id inválido', () => {
    expect(leagueShield('liga-inexistente')).toBe(LEAGUE_SHIELDS.bronze);
    expect(leagueShield(undefined)).toBe(LEAGUE_SHIELDS.bronze);
    expect(leagueShield(null)).toBe(LEAGUE_SHIELDS.bronze);
  });
});
