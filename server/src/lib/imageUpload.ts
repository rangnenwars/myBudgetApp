import { createHash } from 'crypto';
import { badRequest } from './errors';

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

/** Identifies the image from its first bytes: the declared type is the client's claim, this is what the bytes are. */
export const sniffImageType = (buf: Buffer): ImageMime | null => {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
};

/**
 * Turns the base64 (or data: URL) an app sends into bytes, checking size and
 * that it really is one of the allowed image types. `what` names it in errors.
 */
export const decodeImageUpload = (data: string, opts: { maxBytes: number; allowed: ImageMime[]; what: string }): { buf: Buffer; mimeType: ImageMime; sha256: string } => {
  const mb = opts.maxBytes >= 1_048_576 ? `${Math.round(opts.maxBytes / 1_048_576)} MB` : `${Math.round(opts.maxBytes / 1024)} KB`;
  const base64 = data.replace(/^data:[^;,]+;base64,/, '');
  if (!/^[A-Za-z0-9+/\s]+={0,2}$/.test(base64)) throw badRequest(`${opts.what} is not valid base64.`);
  // Cheap pre-check before allocating: 4 base64 chars encode 3 bytes.
  if (Math.floor((base64.replace(/\s/g, '').length * 3) / 4) > opts.maxBytes + 2) throw badRequest(`${opts.what} must be ${mb} or smaller.`);
  const buf = Buffer.from(base64, 'base64');
  if (buf.length === 0) throw badRequest(`${opts.what} is empty.`);
  if (buf.length > opts.maxBytes) throw badRequest(`${opts.what} must be ${mb} or smaller.`);
  const mimeType = sniffImageType(buf);
  if (!mimeType || !opts.allowed.includes(mimeType)) {
    const names = opts.allowed.map((m) => m.replace('image/', '').toUpperCase()).join(', ');
    throw badRequest(`${opts.what} must be a ${names} image.`);
  }
  return { buf, mimeType, sha256: createHash('sha256').update(buf).digest('hex') };
};

/** "data:image/png;base64,…" for sending a stored image back in JSON. */
export const toDataUrl = (buf: Buffer, mimeType: string): string => `data:${mimeType};base64,${buf.toString('base64')}`;
