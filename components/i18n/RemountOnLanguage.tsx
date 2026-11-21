import React from 'react';
import { useLanguage } from '../../context/LanguageContext';

/**
 * Draws its children again from scratch when the language changes. Text that a screen builds from values
 * (`Next: 5 Dec`) is worked out when the screen renders, so a screen has to render again to pick up the new
 * language. The route stays the same, so the person stays on the page they were on.
 */
export const RemountOnLanguage: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { lang } = useLanguage();
  return <React.Fragment key={lang}>{children}</React.Fragment>;
};
