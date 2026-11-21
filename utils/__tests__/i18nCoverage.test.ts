/**
 * Fails when text a person can see has no Hindi, so a new screen or a new server message cannot ship
 * untranslated. To fix a failure: add the English text and its Hindi to utils/i18nHiScreens.ts (screens)
 * or utils/i18nServer.ts (server messages). Text that is code, not words, goes in scripts/i18nIgnore.json.
 */
import { HI } from '../i18nHi';
import { translate } from '../i18n';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const screens = require('../../scripts/i18nExtract.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const server = require('../../scripts/i18nExtractServer.js');

const hasHindi = (text: string): boolean => translate(text, 'hi') !== text || text in HI;

describe('Hindi covers every piece of text', () => {
  it('in the screens', () => {
    const ignore: Set<string> = screens.loadIgnore();
    const { strings } = screens.extractAll() as { strings: Record<string, { file: string; line: number }[]> };
    const missing = Object.keys(strings)
      .filter((text) => !ignore.has(text) && !hasHindi(text))
      .map((text) => `${JSON.stringify(text)}  (${strings[text][0].file}:${strings[text][0].line})`);
    expect(missing).toEqual([]);
  });

  it('in the messages the server sends', () => {
    const { strings } = server.extractAll() as { strings: Record<string, string> };
    const missing = Object.keys(strings)
      .filter((text) => !hasHindi(text))
      .map((text) => `${JSON.stringify(text)}  (${strings[text]})`);
    expect(missing).toEqual([]);
  });

  it('no Hindi entry is left for text that no longer exists in the screens', () => {
    // Keeps the dictionary from growing with dead entries. Server messages and a few shared words are allowed.
    const { strings } = screens.extractAll() as { strings: Record<string, unknown> };
    const serverStrings = server.extractAll().strings as Record<string, unknown>;
    const used = new Set([...Object.keys(strings), ...Object.keys(serverStrings)]);
    const dead = Object.keys(HI).filter((key) => !used.has(key));
    // A small allowance: the tour and a few labels are built from data, not literals.
    expect(dead.length).toBeLessThan(40);
  });
});
