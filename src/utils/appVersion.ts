import * as Application from 'expo-application';
import Constants from 'expo-constants';

/**
 * Versão do app, em um lugar só.
 *
 * Havia duas fontes soltas: o "Mais" caía num `'1.0.0'` literal e a página "Sobre" trazia a
 * versão escrita à mão no meio do texto — que ficou para trás quando o app foi para 1.1.0.
 * Aqui a ordem é: o que o sistema instalou, o que o `app.json` declarou, e só então o literal.
 *
 * `nativeApplicationVersion` é `null` fora de um build nativo (Expo Go, build web), por isso a
 * configuração do Expo entra como segunda fonte — ela é a mesma que gera o número do build.
 */
export const APP_VERSION: string =
  Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0';
