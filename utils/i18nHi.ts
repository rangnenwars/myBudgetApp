import { HI_SCREENS } from './i18nHiScreens';
import { HI_EXTRA } from './i18nHiExtra';
import { HI_SERVER, HI_SERVER_PATTERNS } from './i18nServer';

// All of the Hindi, in one place: the screens' text and the server's messages. See utils/i18n.ts.
export const HI: Record<string, string> = { ...HI_SCREENS, ...HI_EXTRA, ...HI_SERVER };

// Server messages that carry a value: [what the English looks like, the Hindi with $1, $2 for the values].
export const HI_PATTERNS: [RegExp, string][] = HI_SERVER_PATTERNS;
