import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { paymentSettings } from '../db/schema';
import { toDataUrl } from './imageUpload';

// The payment details every user sees on the Renew screen: the UPI ID, the
// name and the QR image an admin uploaded. The QR is READ on upload and its UPI
// ID must match the one typed, so nobody can slip in a QR that pays somewhere else.

/** A UPI ID: name@handle, letters, digits and . _ - only. */
export const UPI_ID_RE = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.-]{1,40}$/;

export const normalizeUpiId = (v: string): string => v.trim().toLowerCase();

/** The payee address (`pa`) inside a upi://pay?… link, or null when it isn't one. */
export const parseUpiPayee = (text: string): string | null => {
  const m = /^upi:\/\/pay\?(.+)$/i.exec(text.trim());
  if (!m) return null;
  const pa = new URLSearchParams(m[1]).get('pa');
  return pa ? normalizeUpiId(pa) : null;
};

const MAX_PIXELS = 12_000_000;

/** What the QR in a PNG or JPEG says, or null when no QR could be read. */
export const readQrText = (buf: Buffer, mimeType: string): string | null => {
  let width: number;
  let height: number;
  let data: Uint8ClampedArray;
  try {
    if (mimeType === 'image/png') {
      const png = PNG.sync.read(buf);
      ({ width, height } = png);
      data = new Uint8ClampedArray(png.data);
    } else if (mimeType === 'image/jpeg') {
      const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 12 });
      ({ width, height } = img);
      data = new Uint8ClampedArray(img.data);
    } else {
      return null;
    }
  } catch {
    return null;
  }
  if (width * height > MAX_PIXELS) return null;
  return jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
};

export type QrCheck = { ok: true; verified: true } | { ok: false; reason: 'mismatch'; found: string } | { ok: false; reason: 'unreadable' };

/** Does the QR in this image pay `upiId`? */
export const checkQr = (buf: Buffer, mimeType: string, upiId: string): QrCheck => {
  const text = readQrText(buf, mimeType);
  if (!text) return { ok: false, reason: 'unreadable' };
  const payee = parseUpiPayee(text);
  if (!payee) return { ok: false, reason: 'unreadable' };
  return payee === normalizeUpiId(upiId) ? { ok: true, verified: true } : { ok: false, reason: 'mismatch', found: payee };
};

/** The saved payment details, or null when an admin hasn't set them yet. */
export const loadPaymentDetails = async () => {
  const [row] = await db.select().from(paymentSettings).where(eq(paymentSettings.id, 1));
  if (!row) return null;
  return {
    upiId: row.upiId,
    payeeName: row.payeeName,
    qr: toDataUrl(row.qrImage, row.qrMimeType),
    qrVerified: row.qrVerified,
    updatedAt: row.updatedAt,
  };
};

/** upi://pay link that opens the user's UPI app with the amount filled in. */
export const upiPayLink = (upiId: string, payeeName: string, amountInr: number, note: string): string => {
  const q = new URLSearchParams({ pa: upiId, pn: payeeName, am: amountInr.toFixed(2), cu: 'INR', tn: note });
  return `upi://pay?${q.toString()}`;
};
