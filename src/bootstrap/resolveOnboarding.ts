/**
 * Decide se quem acabou de entrar já tem cadastro. Só fontes do servidor contam:
 * 1. `bootstrapUser` (duas tentativas);
 * 2. se ele falhar (App Check, função fora do ar), o perfil lido direto do servidor.
 *
 * `null` = o servidor não respondeu. Quem chama NÃO deve mandar para o cadastro nesse caso:
 * um cache vazio não prova que a conta é nova, e cadastrar de novo quem já joga é o bug que isso evita.
 */
export async function resolveOnboarding(deps: {
  bootstrap: () => Promise<{ onboarded?: boolean }>;
  serverProfile: () => Promise<{ nickname?: string | null } | null>;
  report: (e: unknown, where: string) => void;
}): Promise<boolean | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return (await deps.bootstrap()).onboarded === true;
    } catch (e) {
      if (attempt === 1) deps.report(e, 'bootstrapUser');
    }
  }
  try {
    return Boolean((await deps.serverProfile())?.nickname);
  } catch {
    return null;
  }
}
