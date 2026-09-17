import { Platform } from 'react-native';

/**
 * Endereços do backend (NestJS). Vêm do ambiente da build:
 *  - `EXPO_PUBLIC_API_URL`  → REST (ex.: https://api.trucomineiro.com.br)
 *  - `EXPO_PUBLIC_WS_URL`   → Socket.IO (padrão: o mesmo host da API)
 *
 * Em desenvolvimento, sem variável, o app usa o backend local (porta 3000; o emulador Android
 * alcança a máquina em 10.0.2.2). Em build de release a variável é OBRIGATÓRIA: sem ela o app não
 * aponta para lugar nenhum "por acaso" — a chamada falha com erro de configuração.
 */

const DEV_HOST =
  process.env.EXPO_PUBLIC_DEV_API_HOST ?? (Platform.OS === 'android' ? '10.0.2.2' : 'localhost');

function clean(url: string | undefined): string | null {
  const v = url?.trim().replace(/\/+$/, '');
  return v ? v : null;
}

export class ApiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiConfigError';
  }
}

export interface ApiEndpoints {
  apiUrl: string;
  wsUrl: string;
}

let cached: ApiEndpoints | null = null;

export function resolveEndpoints(
  env: { api?: string; ws?: string; dev: boolean; allowInsecure?: boolean } = {
    api: process.env.EXPO_PUBLIC_API_URL,
    ws: process.env.EXPO_PUBLIC_WS_URL,
    dev: __DEV__,
    // Só builds de QA local (app.config.js recusa em staging/produção).
    allowInsecure: process.env.EXPO_PUBLIC_ALLOW_INSECURE_API === '1',
  },
): ApiEndpoints {
  const api = clean(env.api) ?? (env.dev ? `http://${DEV_HOST}:3000` : null);
  if (!api) throw new ApiConfigError('EXPO_PUBLIC_API_URL não configurada nesta build.');
  if (!env.dev && !env.allowInsecure && !api.startsWith('https://'))
    throw new ApiConfigError('EXPO_PUBLIC_API_URL precisa ser https em builds de release.');
  const ws = clean(env.ws) ?? api;
  return { apiUrl: api, wsUrl: ws };
}

export function endpoints(): ApiEndpoints {
  if (!cached) cached = resolveEndpoints();
  return cached;
}
