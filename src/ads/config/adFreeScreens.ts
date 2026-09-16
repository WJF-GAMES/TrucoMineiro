/**
 * Rotas em que **nenhum** anúncio aparece — nem native, nem full-screen, nem App Open ao voltar do
 * background (o caso típico: o jogador sai para ler o SMS e volta para a tela do código).
 *
 * Autenticação e cadastro são o primeiro contato com o app; partida e fila são gameplay.
 * Os nomes são as rotas do `RootNavigator` (a rota de topo em foco).
 */
export const AD_FREE_SCREENS: readonly string[] = [
  'Splash',
  'Intro',
  'Login',
  'Otp',
  'Register',
  'Game',
  'Matchmaking',
  'Lobby',
];

/** `null` = navegação ainda não montou: sem saber a tela, nada de anúncio. */
export function isAdFreeScreen(screen: string | null): boolean {
  return screen === null || AD_FREE_SCREENS.includes(screen);
}
