import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, fontFamily, radius } from '@/design-system';
import { AppText } from './AppText';
import type { Country } from '@/utils/phone';

const inputFont = { fontFamily: fontFamily.semibold, fontSize: 16, color: colors.text };

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
}: {
  country: Country;
  onPressCountry: () => void;
  value: string;
  onChangeText: (v: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  return (
    <View style={styles.phoneRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`País ${country.name}, ${country.dial}`}
        onPress={onPressCountry}
        style={[styles.field, styles.country]}
      >
        <AppText style={{ fontSize: 22, marginRight: 6 }}>{country.flag}</AppText>
        <AppText variant="bodyBold" style={{ fontSize: 16 }}>
          {country.dial}
        </AppText>
        <Ionicons
          name="chevron-down"
          size={16}
          color={colors.textSecondary}
          style={{ marginLeft: 4 }}
        />
      </Pressable>
      <View style={[styles.field, { flex: 1 }]}>
        <TextInput
          testID="phone-input"
          accessibilityLabel="Número de telefone"
          placeholder={placeholder ?? '(61) 9.9628-9726'}
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          autoFocus={autoFocus}
          maxLength={20}
          value={value}
          onChangeText={onChangeText}
          style={[styles.input, inputFont, { fontSize: 17 }]}
        />
      </View>
    </View>
  );
}

/** Six-digit OTP boxes backed by one hidden input (supports SMS autofill). */
export function OtpInput({
  value,
  onChange,
  length = 6,
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
    if (autoFocus) setTimeout(() => ref.current?.focus(), 250);
  }, [autoFocus]);
  const digits = value.split('');
  return (
    <Pressable
      onPress={() => ref.current?.focus()}
      accessibilityLabel="Código de verificação"
      style={styles.otpRow}
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
            <AppText variant="h1" style={{ fontSize: 24 }}>
              {digits[i] ?? ''}
            </AppText>
          </View>
        );
      })}
      <TextInput
        ref={ref}
        testID="otp-input"
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.hidden}
        caretHidden
      />
    </Pressable>
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
  input: { flex: 1, paddingVertical: 12 },
  hint: { marginTop: 6, marginLeft: 4 },
  search: { minHeight: 48 },
  phoneRow: { flexDirection: 'row', gap: 10 },
  country: { paddingHorizontal: 12, minHeight: 56 },
  otpRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  otpBox: {
    flex: 1,
    height: 60,
    borderRadius: radius.input,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpActive: { borderColor: colors.primaryBright },
  otpFilled: { borderColor: colors.cardBorderStrong },
  hidden: { position: 'absolute', opacity: 0, width: 1, height: 1 },
});
