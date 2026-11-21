import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Language, setCurrentLanguage } from '../utils/i18n';
import { loadLanguage, saveLanguage } from '../utils/languagePrefs';

interface LanguageValue {
  lang: Language;
  setLang: (lang: Language) => void;
}

// English until the saved choice is read. Every <Text> reads `lang` from here, so changing the
// language re-renders the whole app in place, without leaving the screen.
const LanguageContext = createContext<LanguageValue>({ lang: 'en', setLang: () => {} });

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>('en');

  useEffect(() => {
    let active = true;
    loadLanguage().then((saved) => {
      if (!active) return;
      setCurrentLanguage(saved);
      setLangState(saved);
    });
    return () => {
      active = false;
    };
  }, []);

  const setLang = useCallback((next: Language) => {
    setCurrentLanguage(next); // first, so text built in a handler right after this is already in the new language
    setLangState(next);
    saveLanguage(next);
  }, []);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = (): LanguageValue => useContext(LanguageContext);
