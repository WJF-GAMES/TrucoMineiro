import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

/**
 * Referência global da navegação.
 *
 * Serve para o que chega de fora de uma tela — convite de sala no Realtime Database, deep link,
 * push — e precisa levar o usuário para algum lugar sem estar dentro da árvore de navegação.
 * Telas continuam usando a prop `navigation`: esta referência não é atalho para isso.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Nome da rota em foco, ou `null` antes da navegação montar. */
export function currentRouteName(): string | null {
  return navigationRef.isReady() ? (navigationRef.getCurrentRoute()?.name ?? null) : null;
}
