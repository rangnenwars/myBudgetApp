import { parseAmount } from '../amount';

describe('parseAmount', () => {
  it('reads plain numbers', () => {
    expect(parseAmount('500')).toBe(500);
    expect(parseAmount('1200.50')).toBe(1200.5);
    expect(parseAmount('.5')).toBe(0.5);
    expect(parseAmount('  75  ')).toBe(75);
  });

  it('keeps the whole number when it has commas or spaces (not just the digits before the first one)', () => {
    expect(parseAmount('1,00,000')).toBe(100000);
    expect(parseAmount('1,200.50')).toBe(1200.5);
    expect(parseAmount('1 000')).toBe(1000);
    expect(parseAmount('12,34,567.89')).toBe(1234567.89);
  });

  it('drops a leading rupee sign or Rs', () => {
    expect(parseAmount('₹1,200')).toBe(1200);
    expect(parseAmount('₹ 99')).toBe(99);
    expect(parseAmount('Rs. 2,500')).toBe(2500);
    expect(parseAmount('rs500')).toBe(500);
  });

  it('is NaN for anything that is not a plain number, instead of a truncated value', () => {
    for (const bad of ['', '   ', 'abc', '50k', '12.50.3', '1e5', '5-0', '₹', '1,2,x', '--5', '0x10']) {
      expect(parseAmount(bad)).toBeNaN();
    }
  });

  it('rejects negatives unless allowed, as for an account balance below zero', () => {
    expect(parseAmount('-500')).toBeNaN();
    expect(parseAmount('-500', { allowNegative: true })).toBe(-500);
    expect(parseAmount('-1,500.25', { allowNegative: true })).toBe(-1500.25);
    expect(parseAmount('500', { allowNegative: true })).toBe(500);
  });
});
