import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, fontFamily, radius, shadows } from '@/design-system';
import { AppText } from './AppText';
import { CountryFlag } from './CountryFlag';
import { PHONE_PLACEHOLDER, type Country } from '@/utils/phone';
import { OTP_LENGTH, sanitizeOtp } from '@/utils/otp';

/**
 * O navegador desenha um contorno amarelo/azul de foco por cima do campo, brigando com a borda
 * verde do próprio design. No app nativo isso não existe, então o reset é só para a build web.
 * `outlineStyle` é uma propriedade do react-native-web e não está nos tipos do React Native.
 */
const noWebOutline = (
  Platform.OS === 'web' ? { outlineStyle: 'none' } : null
) as TextStyle | null;

const inputFont = {
  fontFamily: fontFamily.semibold,
  fontSize: 16,
  color: colors.text,
  ...(noWebOutline ?? {}),
};

/** Dark rounded text field (nickname, room code). */
export function TextField({
  label,
  hint,
  valid,
  style,
  error,
  ...props
}: TextInputProps & {
  label?: string;
  hint?: string;
  valid?: boolean;
  error?: string | null;
  style?: ViewStyle;
}) {
  return (
    <View style={style}>
      {label ? (
        <View style={styles.labelTag}>
          <AppText variant="small" color={colors.textSecondary}>
            {label}
          </AppText>
        </View>
      ) : null}
      <View style={[styles.field, error ? styles.fieldError : null]}>
        <TextInput
          placeholderTextColor={colors.textMuted}
          style={[styles.input, inputFont]}
          {...props}
        />
        {valid ? <Ionicons name="checkmark" size={22} color={colors.primaryBright} /> : null}
      </View>
      {error ? (
        <AppText variant="small" color={colors.dangerSoft} style={styles.hint}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="small" color={colors.textSecondary} style={styles.hint}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

/** Search bar with magnifier icon. */
export function SearchField(props: TextInputProps) {
  return (
    <View style={[styles.field, styles.search]}>
      <Ionicons name="search" size={20} color={colors.textSecondary} style={{ marginRight: 10 }} />
      <TextInput
        placeholderTextColor={colors.textMuted}
        style={[styles.input, inputFont, { fontSize: 15 }]}
        returnKeyType="search"
        {...props}
      />
    </View>
  );
}

/** Country selector + phone number field (Login). */
export function PhoneInput({
  country,
  onPressCountry,
  value,
  onChangeText,
  autoFocus,
  placeholder,
  error,
}: {
  country: Country;
  onPressCountry: () => void;
  value: string;
  onChangeText: (v: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
  /** Pinta a borda de vermelho quando a tela reporta um erro do número. */
  error?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.phoneRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`País ${country.name}, ${country.dial}`}
        onPress={onPressCountry}
        style={[styles.field, styles.country]}
      >
        <CountryFlag country={country} width={26} />
        <AppText variant="bodyBold" style={styles.dial}>
          {country.dial}
        </AppText>
        <Ionicons
          name="chevron-down"
          size={16}
          color={colors.textSecondary}
          style={{ marginLeft: 4 }}
        />
      </Pressable>
      <View
        style={[
          styles.field,
          styles.phoneField,
          focused ? styles.fieldFocused : null,
          error ? styles.fieldError : null,
        ]}
      >
        <TextInput
          testID="phone-input"
          accessibilityLabel="Número de telefone"
          placeholder={placeholder ?? PHONE_PLACEHOLDER[country.code]}
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
          inputMode="tel"
          textContentType="telephoneNumber"
          autoComplete="tel"
          autoFocus={autoFocus}
          maxLength={20}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.input, inputFont, styles.phoneText]}
        />
      </View>
    </View>
  );
}

/**
 * Código de 6 dígitos: um único TextInput real por cima de 6 células visuais.
 *
 * O input precisa ser do tamanho das células e opaco (só o texto e o cursor são
 * transparentes). Um campo 1x1 com `opacity: 0` é ignorado pelo autofill do Android
 * e pela sugestão do teclado no iOS — era por isso que o código do SMS não aparecia.
 * `autoComplete="sms-otp"` (Android) e `textContentType="oneTimeCode"` (iOS) fazem o
 * sistema oferecer o código; nenhuma permissão de leitura de SMS é usada.
 */
export function OtpInput({
  value,
  onChange,
  length = OTP_LENGTH,
  error,
  autoFocus = true,
}: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  error?: boolean;
  autoFocus?: boolean;
}) {
  const ref = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    // Espera a transição de tela terminar, senão o foco se perde no meio da animação.
    if (!autoFocus) return;
    const t = setTimeout(() => ref.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [autoFocus]);
  const digits = value.split('');
  return (
    <View style={styles.otpWrap}>
      {/* O campo fica ATRÁS das células: no Android o texto dele ainda aparece por cima
          mesmo com `color: 'transparent'` (o IME desenha o texto em composição). */}
      <TextInput
        ref={ref}
        testID="otp-input"
        accessibilityLabel={`Código de verificação de ${length} dígitos`}
        value={value}
        onChangeText={(t) => onChange(sanitizeOtp(t, length))}
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        importantForAutofill="yes"
        maxLength={length}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.otpInput, noWebOutline]}
        caretHidden
        selectionColor="transparent"
      />
      <View
        style={styles.otpRow}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {Array.from({ length }).map((_, i) => {
          const active = focused && digits.length === i;
          return (
            <View
              key={i}
              style={[
                styles.otpBox,
                active && styles.otpActive,
                error && styles.fieldError,
                digits[i] ? styles.otpFilled : null,
              ]}
            >
              <AppText variant="h1" style={styles.otpDigit}>
                {digits[i] ?? ''}
              </AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labelTag: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(20, 62, 59, 0.9)',
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginLeft: 2,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.cardBorder,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 54,
    borderRadius: radius.input,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 14,
  },
  fieldError: { borderColor: colors.dangerSoft },
  fieldFocused: { borderColor: colors.primary },
  phoneField: { flex: 1 },
  phoneText: { fontSize: 17 },
  input: { flex: 1, paddingVertical: 12 },
  hint: { marginTop: 6, marginLeft: 4 },
  search: { minHeight: 48 },
  phoneRow: { flexDirection: 'row', gap: 10 },
  country: { paddingHorizontal: 12, minHeight: 56 },
  dial: { fontSize: 16, marginLeft: 8 },
  otpWrap: { position: 'relative', height: 60 },
  otpRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  otpDigit: { fontSize: 24 },
  // Cobre as células inteiras: o autofill precisa de um campo visível e do tamanho real.
  // Ocupa a área toda das células: o autofill precisa de um campo visível e do tamanho real.
  // `color: 'transparent'` não basta no Android (o IME desenha o texto em composição),
  // então a fonte também é reduzida: o campo continua do tamanho real para o autofill.
  otpInput: {
    height: '100%',
    width: '100%',
    color: 'transparent',
    fontSize: 1,
    textAlign: 'center',
  },
  otpBox: {
    flex: 1,
    height: '100%',
    borderRadius: radius.input,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpActive: {
    borderColor: colors.primaryBright,
    borderWidth: 2,
    backgroundColor: colors.primaryGlow,
    ...shadows.glowGreen,
  },
  otpFilled: { borderColor: colors.cardBorderStrong },
});
