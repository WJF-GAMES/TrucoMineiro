import { resolveOnboarding } from '../resolveOnboarding';

const fail = () => Promise.reject(new Error('unavailable'));

describe('resolveOnboarding', () => {
  it('usa o bootstrap quando ele responde', async () => {
    const serverProfile = jest.fn();
    await expect(
      resolveOnboarding({
        bootstrap: async () => ({ onboarded: true }),
        serverProfile,
        report: jest.fn(),
      }),
    ).resolves.toBe(true);
    expect(serverProfile).not.toHaveBeenCalled();
  });

  it('tenta o bootstrap de novo antes de desistir', async () => {
    const bootstrap = jest
      .fn()
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce({ onboarded: false });
    await expect(
      resolveOnboarding({ bootstrap, serverProfile: jest.fn(), report: jest.fn() }),
    ).resolves.toBe(false);
    expect(bootstrap).toHaveBeenCalledTimes(2);
  });

  it('bootstrap fora do ar: quem já tem cadastro no servidor vai para a Home', async () => {
    const report = jest.fn();
    await expect(
      resolveOnboarding({
        bootstrap: fail,
        serverProfile: async () => ({ nickname: 'Will' }),
        report,
      }),
    ).resolves.toBe(true);
    expect(report).toHaveBeenCalledWith(expect.any(Error), 'bootstrapUser');
  });

  it('bootstrap fora do ar: sem perfil (ou sem apelido) no servidor vai para o cadastro', async () => {
    for (const profile of [null, { nickname: '' }]) {
      await expect(
        resolveOnboarding({
          bootstrap: fail,
          serverProfile: async () => profile,
          report: jest.fn(),
        }),
      ).resolves.toBe(false);
    }
  });

  it('servidor inalcançável: não decide (nunca manda para o cadastro por falta de dado)', async () => {
    await expect(
      resolveOnboarding({ bootstrap: fail, serverProfile: fail, report: jest.fn() }),
    ).resolves.toBeNull();
  });
});
