import { formatAsYouType, maskPhone, toE164 } from '../phone';

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
