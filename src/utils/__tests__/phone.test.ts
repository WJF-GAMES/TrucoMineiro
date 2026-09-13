import {
  countryOf,
  formatAsYouType,
  initialsOf,
  maskPhone,
  normalizePhoneNumber,
  toE164,
} from '../phone';

describe('Brazilian phone mask', () => {
  it('formats progressively as the user types', () => {
    expect(formatAsYouType('6', 'BR')).toBe('(6');
    expect(formatAsYouType('61', 'BR')).toBe('(61');
    expect(formatAsYouType('619', 'BR')).toBe('(61) 9');
    expect(formatAsYouType('619962', 'BR')).toBe('(61) 9.962');
    expect(formatAsYouType('61996289726', 'BR')).toBe('(61) 9.9628-9726');
  });

  it('formats landlines without the dot', () => {
    expect(formatAsYouType('6132245566', 'BR')).toBe('(61) 3224-5566');
  });

  it('ignores extra digits and existing mask characters', () => {
    expect(formatAsYouType('(61) 9.9628-9726', 'BR')).toBe('(61) 9.9628-9726');
    expect(formatAsYouType('619962897269999', 'BR')).toBe('(61) 9.9628-9726');
  });

  it('converts to E.164 with no mask characters', () => {
    expect(toE164('(61) 9.9628-9726', 'BR')).toBe('+5561996289726');
    expect(toE164('61996289726', 'BR')).toBe('+5561996289726');
    expect(toE164('', 'BR')).toBeNull();
    expect(toE164('(61) 9.96', 'BR')).toBeNull();
    expect(/^\+\d+$/.test(toE164('(61) 9.9628-9726', 'BR')!)).toBe(true);
  });

  it('masks the number for display on the OTP screen', () => {
    expect(maskPhone('+5561996289726')).toBe('(61) 9.****-9726');
  });
});

describe('normalizePhoneNumber', () => {
  it('trata toda grafia da agenda como o mesmo número', () => {
    const expected = '+5561996289726';
    for (const raw of [
      '(61) 9.9628-9726',
      '61996289726',
      '+55 61 99628-9726',
      '+55 (61) 99628 9726',
      ' 61 9 9628-9726 ',
      '55 61 99628-9726',
    ]) {
      expect(normalizePhoneNumber(raw, 'BR')).toBe(expected);
    }
  });

  it('mantém o país do próprio contato quando ele traz DDI', () => {
    // Conta brasileira, contato português: o DDI do contato manda.
    expect(normalizePhoneNumber('+351 912 345 678', 'BR')).toBe('+351912345678');
    expect(normalizePhoneNumber('+1 415 555 2671', 'BR')).toBe('+14155552671');
  });

  it('usa o país da conta quando o número não tem DDI', () => {
    // Sem DDI só resta a heurística do país: o MESMO número vira países diferentes.
    // É por isso que `countryOf(telefone do usuário)` alimenta a normalização da agenda.
    expect(normalizePhoneNumber('912345678', 'PT')).toBe('+351912345678');
    expect(normalizePhoneNumber('912345678', 'BR')).toBe('+55912345678');
  });

  it('devolve null para o que não é telefone', () => {
    for (const raw of ['', '   ', 'liga pra mim', '123', '*#06#', '61 9962'])
      expect(normalizePhoneNumber(raw, 'BR')).toBeNull();
  });

  it('ignora sinais de discagem que a agenda às vezes guarda', () => {
    expect(normalizePhoneNumber('61.99628.9726', 'BR')).toBe('+5561996289726');
    expect(normalizePhoneNumber('61/99628-9726', 'BR')).toBe('+5561996289726');
  });

  it('nunca devolve máscara — só dígitos e o "+"', () => {
    const e164 = normalizePhoneNumber('(61) 9.9628-9726', 'BR')!;
    expect(/^\+\d+$/.test(e164)).toBe(true);
  });
});

describe('countryOf', () => {
  it('descobre o país a partir do telefone da conta', () => {
    expect(countryOf('+5561996289726')).toBe('BR');
    expect(countryOf('+351912345678')).toBe('PT');
  });

  it('cai no Brasil quando não dá para saber', () => {
    expect(countryOf(null)).toBe('BR');
    expect(countryOf('')).toBe('BR');
  });
});

describe('initialsOf', () => {
  it('usa primeiro e último nome', () => {
    expect(initialsOf('João Faculdade')).toBe('JF');
    expect(initialsOf('Maria da Silva Souza')).toBe('MS');
    expect(initialsOf('Tião')).toBe('T');
  });

  it('aguenta nome vazio, emoji e acento', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf('🙂')).toBe('?');
    expect(initialsOf('Ângela Ómega')).toBe('ÂÓ');
  });
});
