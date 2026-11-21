import { ARROW_EDGE, ARROW_GAP, BUBBLE_MARGIN, BUBBLE_MAX_WIDTH, dimRects, isUsable, padRect, placeBubble } from '../tourSpotlight';
import { TOUR_STEPS, stepsFor } from '../tour';

const phone = { width: 375, height: 812 };

describe('isUsable', () => {
  it('accepts an item that is on screen', () => {
    expect(isUsable({ x: 20, y: 100, width: 300, height: 80 }, phone)).toBe(true);
  });
  it('rejects nothing, a zero size, or NaN', () => {
    expect(isUsable(null, phone)).toBe(false);
    expect(isUsable(undefined, phone)).toBe(false);
    expect(isUsable({ x: 0, y: 0, width: 0, height: 50 }, phone)).toBe(false);
    expect(isUsable({ x: 0, y: 0, width: 50, height: NaN }, phone)).toBe(false);
  });
  it('rejects an item below the fold, accepts one only just clipped', () => {
    expect(isUsable({ x: 20, y: 900, width: 300, height: 80 }, phone)).toBe(false);
    expect(isUsable({ x: 20, y: 760, width: 300, height: 80 }, phone)).toBe(false); // 50 of 80 visible
    expect(isUsable({ x: 20, y: 740, width: 300, height: 80 }, phone)).toBe(true); // 72 of 80 is enough
  });
  it('rejects one scrolled off the top or the side', () => {
    expect(isUsable({ x: 20, y: -70, width: 300, height: 80 }, phone)).toBe(false);
    expect(isUsable({ x: 360, y: 100, width: 300, height: 80 }, phone)).toBe(false);
  });
});

describe('padRect', () => {
  it('grows the item and keeps it on the screen', () => {
    expect(padRect({ x: 20, y: 100, width: 300, height: 80 }, 6, phone)).toEqual({ x: 14, y: 94, width: 312, height: 92 });
    expect(padRect({ x: 2, y: 2, width: 100, height: 40 }, 6, phone)).toEqual({ x: 0, y: 0, width: 108, height: 48 });
    expect(padRect({ x: 300, y: 780, width: 70, height: 30 }, 6, phone)).toEqual({ x: 294, y: 774, width: 81, height: 38 });
  });
});

describe('dimRects', () => {
  const hole = { x: 20, y: 100, width: 300, height: 80 };
  it('covers everything but the item: the four pieces add up to the screen minus the hole', () => {
    const rects = dimRects(hole, phone);
    const area = rects.reduce((s, r) => s + r.width * r.height, 0);
    expect(area).toBe(phone.width * phone.height - hole.width * hole.height);
  });
  it('leaves no piece where the item touches an edge', () => {
    const rects = dimRects({ x: 0, y: 0, width: 375, height: 80 }, phone);
    expect(rects).toEqual([{ x: 0, y: 80, width: 375, height: 732 }]);
  });
  it('never makes a piece with no size', () => {
    for (const r of dimRects({ x: 0, y: 700, width: 375, height: 112 }, phone)) {
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
    }
  });
});

describe('placeBubble', () => {
  it('goes below an item near the top, arrow pointing up at its centre', () => {
    const p = placeBubble({ x: 20, y: 100, width: 300, height: 80 }, phone, 200)!;
    expect(p.arrow).toBe('up');
    expect(p.top).toBe(100 + 80 + ARROW_GAP);
    expect(p.left + p.arrowLeft).toBeCloseTo(20 + 150);
  });
  it('goes above an item near the bottom, arrow pointing down', () => {
    const p = placeBubble({ x: 150, y: 700, width: 56, height: 56 }, phone, 200)!;
    expect(p.arrow).toBe('down');
    expect(p.top + 200 + ARROW_GAP).toBe(700);
    expect(p.top).toBeGreaterThanOrEqual(0);
  });
  it('gives up when it fits neither side, so the caller can show a centred card', () => {
    expect(placeBubble({ x: 20, y: 200, width: 300, height: 300 }, { width: 375, height: 700 }, 200)).toBeNull();
  });
  it('stays inside the screen sideways, with the arrow still on the item', () => {
    const edge = placeBubble({ x: 330, y: 100, width: 40, height: 40 }, phone, 200)!;
    expect(edge.left + edge.width).toBeLessThanOrEqual(phone.width - BUBBLE_MARGIN);
    expect(edge.arrowLeft).toBe(edge.width - ARROW_EDGE); // as near the item as the bubble's edge allows
    const left = placeBubble({ x: 0, y: 100, width: 20, height: 40 }, phone, 200)!;
    expect(left.left).toBe(BUBBLE_MARGIN);
    expect(left.arrowLeft).toBe(ARROW_EDGE);
  });
  it('is no wider than the maximum on a big screen, and fits a narrow one', () => {
    expect(placeBubble({ x: 100, y: 100, width: 100, height: 40 }, { width: 1024, height: 768 }, 200)!.width).toBe(BUBBLE_MAX_WIDTH);
    expect(placeBubble({ x: 10, y: 100, width: 100, height: 40 }, { width: 300, height: 700 }, 200)!.width).toBe(300 - 2 * BUBBLE_MARGIN);
  });
  it('never puts the arrow off the bubble', () => {
    for (const x of [0, 10, 100, 200, 340]) {
      const p = placeBubble({ x, y: 100, width: 30, height: 30 }, phone, 200)!;
      expect(p.arrowLeft).toBeGreaterThanOrEqual(ARROW_EDGE);
      expect(p.arrowLeft).toBeLessThanOrEqual(p.width - ARROW_EDGE);
    }
  });
  it('gives up on an unusably narrow screen', () => {
    expect(placeBubble({ x: 0, y: 0, width: 10, height: 10 }, { width: 20, height: 600 }, 100)).toBeNull();
  });
});

describe('the tour steps', () => {
  it('starts with a welcome and ends with a card, with no item to point at on either', () => {
    expect(TOUR_STEPS[0].target).toBeUndefined();
    expect(TOUR_STEPS[TOUR_STEPS.length - 1].target).toBeUndefined();
  });
  it('walks Home top to bottom, then the other pages from the tab bar', () => {
    const targets = TOUR_STEPS.map((s) => s.target).filter(Boolean) as string[];
    expect(targets.filter((t) => t.startsWith('home-'))).toEqual(['home-header', 'home-settings', 'home-add', 'home-month', 'home-money', 'home-people', 'home-summary', 'home-categories', 'home-recent', 'home-insights', 'home-more']);
    expect(targets.filter((t) => t.startsWith('tab-'))).toEqual(['tab-transactions', 'tab-loans', 'tab-investments', 'tab-goals', 'tab-reports']);
    expect(targets.findIndex((t) => t.startsWith('tab-'))).toBeGreaterThan(targets.lastIndexOf('home-more') === -1 ? 0 : targets.indexOf('home-more'));
  });
  it('every item is named once', () => {
    const targets = TOUR_STEPS.map((s) => s.target).filter(Boolean);
    expect(new Set(targets).size).toBe(targets.length);
  });
  it('leaves out a step whose optional item is not on screen, and keeps everything else', () => {
    const all = stepsFor(() => true).map((s) => s.key);
    expect(all).toEqual(TOUR_STEPS.map((s) => s.key));
    const bare = stepsFor(() => false).map((s) => s.key);
    for (const key of ['money', 'recent', 'more', 'goals', 'loans', 'investments']) expect(bare).not.toContain(key);
    for (const key of ['welcome', 'header', 'settings', 'add', 'month', 'people', 'summary', 'categories', 'insights', 'transactions', 'reports', 'ready']) expect(bare).toContain(key);
  });
  it('only an optional step can be dropped', () => {
    const dropped = TOUR_STEPS.filter((s) => !stepsFor(() => false).includes(s));
    expect(dropped.length).toBeGreaterThan(0);
    for (const s of dropped) expect(s.optional).toBe(true);
  });
});
