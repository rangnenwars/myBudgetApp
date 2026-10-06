import { balanceLabel, emptyPeopleSplit, filterPeople, fmtAmount, NEW_PERSON, peopleSplitProblem, planPeopleSplit, shortDate } from '../people';
import { Person } from '../types';

const person = (over: Partial<Person>): Person => ({ id: 1, name: 'A', balance: 0, dueDate: null, overdue: false, lastActivity: null, ...over });

describe('fmtAmount', () => {
  it('shows whole rupees without paise, and paise when present', () => {
    expect(fmtAmount(1200)).toBe('₹1,200');
    expect(fmtAmount(1200.5)).toBe('₹1,200.50');
    expect(fmtAmount(123456)).toBe('₹1,23,456');
  });

  it('is always positive: the words carry the direction', () => {
    expect(fmtAmount(-600)).toBe('₹600');
  });
});

describe('balanceLabel', () => {
  it('says who owes whom in words', () => {
    expect(balanceLabel(600).text).toBe('You get ₹600');
    expect(balanceLabel(-500).text).toBe('You owe ₹500');
    expect(balanceLabel(0).text).toBe('Settled');
  });
});

describe('filterPeople', () => {
  const list = [
    person({ id: 1, balance: 600 }),
    person({ id: 2, balance: -500 }),
    person({ id: 3, balance: 0 }),
    person({ id: 4, balance: 100, overdue: true }),
  ];
  it('filters by direction and overdue', () => {
    expect(filterPeople(list, 'all')).toHaveLength(4);
    expect(filterPeople(list, 'get').map((p) => p.id)).toEqual([1, 4]);
    expect(filterPeople(list, 'owe').map((p) => p.id)).toEqual([2]);
    expect(filterPeople(list, 'overdue').map((p) => p.id)).toEqual([4]);
  });
});

describe('shortDate', () => {
  const now = new Date('2026-10-06T10:00:00');
  it('leaves out the year when it is this year', () => {
    expect(shortDate('2026-10-13', now)).toBe('13 Oct');
  });
  it('adds the year otherwise', () => {
    expect(shortDate('2027-01-05', now)).toBe('5 Jan 2027');
  });
});

describe('planPeopleSplit', () => {
  it('shares equally between friends and you', () => {
    const plan = planPeopleSplit(1800, { ...emptyPeopleSplit(), picked: [1, 2] });
    expect(plan.shares).toEqual({ 1: 600, 2: 600 });
    expect(plan.myShare).toBe(600);
  });

  it('keeps the leftover paise with you', () => {
    const plan = planPeopleSplit(100, { ...emptyPeopleSplit(), picked: [1, 2] });
    expect(plan.shares).toEqual({ 1: 33.33, 2: 33.33 });
    expect(plan.myShare).toBe(33.34);
  });

  it('counts a typed new name as one more person', () => {
    const plan = planPeopleSplit(900, { ...emptyPeopleSplit(), picked: [7], newName: ' Sana ' });
    expect(plan.keys).toEqual([7, NEW_PERSON]);
    expect(plan.shares).toEqual({ 7: 300, [NEW_PERSON]: 300 });
    expect(plan.myShare).toBe(300);
  });

  it('uses typed amounts for a custom split, and your share is the rest', () => {
    const plan = planPeopleSplit(1500, { ...emptyPeopleSplit(), method: 'custom', picked: [1, 2], shares: { 1: '1000', 2: '300' } });
    expect(plan.shares).toEqual({ 1: 1000, 2: 300 });
    expect(plan.myShare).toBe(200);
  });
});

describe('peopleSplitProblem', () => {
  const equal = (picked: number[]) => ({ ...emptyPeopleSplit(), picked });

  it('asks for an amount and for people first', () => {
    expect(peopleSplitProblem(0, equal([1]))).toMatch(/how much/);
    expect(peopleSplitProblem(500, equal([]))).toMatch(/who shared/);
  });

  it('accepts a normal equal split', () => {
    expect(peopleSplitProblem(1800, equal([1, 2]))).toBeNull();
  });

  it('refuses an amount too small to split', () => {
    expect(peopleSplitProblem(0.01, equal([1, 2]))).toMatch(/too small/);
  });

  it('needs every custom share, and not more than the total', () => {
    const custom = (shares: Record<number, string>) => ({ ...emptyPeopleSplit(), method: 'custom' as const, picked: [1, 2], shares });
    expect(peopleSplitProblem(1000, custom({ 1: '500' }))).toMatch(/each person/);
    expect(peopleSplitProblem(1000, custom({ 1: '700', 2: '500' }))).toMatch(/₹200 more than the total/);
    expect(peopleSplitProblem(1000, custom({ 1: '400', 2: '600' }))).toBeNull();
  });
});
