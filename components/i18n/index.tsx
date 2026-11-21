import React, { forwardRef } from 'react';
import { Text as RNText, TextInput as RNTextInput, TextProps, TextInputProps } from 'react-native';
import { useLanguage } from '../../context/LanguageContext';
import { translate, translateNode } from '../../utils/i18n';

// Drop-in replacements for react-native's Text and TextInput. The screens import these instead, so
// every string they show is translated into the chosen language, and re-translated when it changes.
// Strings that are not in the dictionary (names, amounts, anything a user typed) show as they are.

export const Text = forwardRef<RNText, TextProps>(function Text({ children, accessibilityLabel, ...rest }, ref) {
  const { lang } = useLanguage();
  return (
    <RNText ref={ref} accessibilityLabel={accessibilityLabel ? translate(accessibilityLabel, lang) : accessibilityLabel} {...rest}>
      {translateNode(children, lang) as React.ReactNode}
    </RNText>
  );
});
export type Text = RNText;

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ placeholder, accessibilityLabel, ...rest }, ref) {
  const { lang } = useLanguage();
  return (
    <RNTextInput
      ref={ref}
      placeholder={placeholder ? translate(placeholder, lang) : placeholder}
      accessibilityLabel={accessibilityLabel ? translate(accessibilityLabel, lang) : accessibilityLabel}
      {...rest}
    />
  );
});
export type TextInput = RNTextInput;
