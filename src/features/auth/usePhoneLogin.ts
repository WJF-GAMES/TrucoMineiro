import { useCallback, useRef, useState } from 'react';
import { COUNTRIES, Country, formatAsYouType, toE164 } from '@/utils/phone';
import { AuthError, signInWithPhoneNumber } from '@/services/firebase/auth';
import { useAuthStore } from '@/stores/authStore';
import { logEvent } from '@/services/firebase/analytics';
import { haptic } from '@/utils/haptics';

export const LOGIN_MESSAGES = {
  invalid: 'Informe um número de telefone válido.',
  unknown: 'Não foi possível enviar o código. Tente novamente.',
} as const;

interface PhoneLogin {
  country: Country;
  phone: string;
  error: string | null;
  loading: boolean;
  canContinue: boolean;
  changeCountry: (c: Country) => void;
  changePhone: (raw: string) => void;
  submit: () => Promise<void>;
}

/**
 * Estado da tela de Login: máscara, validação, envio do SMS e mensagens de erro.
 *
 * A tela só desenha; quem fala com o Firebase é `services/firebase/auth`.
 * O número só vira E.164 aqui e nunca é logado (analytics recebe apenas o evento).
 *
 * Sem checagem de rede antes de enviar: o estado da conexão com o backend não diz se o Auth
 * está acessível (são serviços independentes), e um
 * falso "sem conexão" travaria o acesso. Quem erra por rede é o próprio Firebase, e o
 * `AuthError` dele já vira "Sem conexão. Verifique sua internet.".
 */
export function usePhoneLogin(onCodeSent: () => void): PhoneLogin {
  const [country, setCountry] = useState<Country>(COUNTRIES[0]!);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setPending = useAuthStore((s) => s.setPending);
  // Trava síncrona: `loading` só vale no próximo render e não barraria um toque duplo.
  const sending = useRef(false);

  const e164 = toE164(phone, country.code);

  const changeCountry = useCallback((c: Country) => {
    setCountry(c);
    setPhone('');
    setError(null);
  }, []);

  const changePhone = useCallback(
    (raw: string) => {
      setPhone(formatAsYouType(raw, country.code));
      setError(null); // não brigar com quem ainda está digitando
    },
    [country.code],
  );

  const submit = useCallback(async () => {
    if (sending.current) return;
    if (!e164) {
      setError(LOGIN_MESSAGES.invalid);
      haptic.error();
      return;
    }
    sending.current = true;
    setError(null);
    setLoading(true);
    try {
      const confirmation = await signInWithPhoneNumber(e164);
      setPending(e164, confirmation);
      logEvent('otp_sent');
      onCodeSent();
    } catch (e) {
      setError(e instanceof AuthError ? e.message : LOGIN_MESSAGES.unknown);
      haptic.error();
    } finally {
      sending.current = false;
      setLoading(false);
    }
  }, [e164, onCodeSent, setPending]);

  return {
    country,
    phone,
    error,
    loading,
    canContinue: Boolean(e164) && !loading,
    changeCountry,
    changePhone,
    submit,
  };
}
