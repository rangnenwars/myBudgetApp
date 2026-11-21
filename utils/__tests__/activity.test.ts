import { ActivityBuffer, MAX_BATCH, MAX_BUFFERED, getSessionId, newSessionId, resetSessionId } from '../activity';

describe('session id', () => {
  it('looks like a uuid and differs each time', () => {
    const a = newSessionId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newSessionId()).not.toBe(a);
  });
  it('stays the same until reset', () => {
    const first = getSessionId();
    expect(getSessionId()).toBe(first);
    const second = resetSessionId();
    expect(second).not.toBe(first);
    expect(getSessionId()).toBe(second);
  });
});

describe('ActivityBuffer', () => {
  const at = new Date('2026-11-21T10:00:00Z');
  it('keeps the pattern, never the real address', () => {
    const b = new ActivityBuffer();
    b.add('/people/42?from=x', at);
    b.add('/monthly-expenses/2026-11', at);
    expect(b.drain().map((h) => h.path)).toEqual(['/people/[id]', '/monthly-expenses/[ym]']);
  });
  it('skips unknown pages', () => {
    const b = new ActivityBuffer();
    expect(b.add('/secret-page', at)).toBe(false);
    expect(b.size).toBe(0);
  });
  it('skips the same page twice in a row but keeps it after another page', () => {
    const b = new ActivityBuffer();
    b.add('/', at);
    expect(b.add('/', at)).toBe(false);
    b.add('/goals', at);
    b.add('/', at);
    expect(b.drain().map((h) => h.path)).toEqual(['/', '/goals', '/']);
  });
  it('treats the same pattern with a different id as a repeat', () => {
    const b = new ActivityBuffer();
    b.add('/people/1', at);
    expect(b.add('/people/2', at)).toBe(false);
  });
  it('stamps the time', () => {
    const b = new ActivityBuffer();
    b.add('/', at);
    expect(b.drain()[0].at).toBe('2026-11-21T10:00:00.000Z');
  });
  it('hands out at most 50 at a time', () => {
    const b = new ActivityBuffer();
    for (let i = 0; i < 120; i++) b.add(i % 2 ? '/' : '/goals', at);
    expect(b.drain()).toHaveLength(MAX_BATCH);
    expect(b.size).toBe(70);
  });
  it('never holds more than the cap, dropping the oldest', () => {
    const b = new ActivityBuffer();
    for (let i = 0; i < MAX_BUFFERED + 30; i++) b.add(i % 2 ? '/' : '/goals', new Date(at.getTime() + i * 1000));
    expect(b.size).toBe(MAX_BUFFERED);
    expect(b.drain()[0].at).toBe(new Date(at.getTime() + 30 * 1000).toISOString());
  });
  it('puts a batch back in front when sending failed', () => {
    const b = new ActivityBuffer();
    b.add('/', at);
    b.add('/goals', at);
    const batch = b.drain();
    b.add('/reports', at);
    b.restore(batch);
    expect(b.drain().map((h) => h.path)).toEqual(['/', '/goals', '/reports']);
  });
  it('clear forgets everything, including the last page', () => {
    const b = new ActivityBuffer();
    b.add('/', at);
    b.clear();
    expect(b.size).toBe(0);
    expect(b.add('/', at)).toBe(true);
  });
});
