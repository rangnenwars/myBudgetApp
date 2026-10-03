import { Request } from 'express';

/** Reads one cookie from the request's Cookie header — the API only ever needs the refresh cookie, so no cookie-parser dependency. */
export const readCookie = (req: Request, name: string): string | undefined => {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    if (part.slice(0, eqIdx).trim() !== name) continue;
    const raw = part.slice(eqIdx + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
};
