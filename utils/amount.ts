/**
 * Reads a money amount typed (or pasted) into a form field. People write
 * "1,00,000", "₹1,200.50" or "1 000"; plain parseFloat stops at the first
 * comma or space and would quietly save ₹1, so those separators and a leading
 * ₹ / Rs are dropped first. Anything else that isn't a plain number ("50k",
 * "12.50.3", "1e5", "-5") is NaN, which every caller already rejects with its
 * "Enter a valid amount" message. Positive-only: pass `allowNegative` for
 * balances that can be below zero.
 */
export const parseAmount = (text: string, opts: { allowNegative?: boolean } = {}): number => {
  const cleaned = text
    .trim()
    .replace(/^(₹|rs\.?|inr)\s*/i, '')
    .replace(/[,\s]/g, '');
  const pattern = opts.allowNegative ? /^-?(\d+\.?\d*|\.\d+)$/ : /^(\d+\.?\d*|\.\d+)$/;
  return pattern.test(cleaned) ? Number(cleaned) : NaN;
};
