// Where things go on screen during the guided tour: the dimmed area around the highlighted item, and the
// message bubble with its arrow. Pure numbers in, numbers out, so it can be tested without a screen.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Size {
  width: number;
  height: number;
}

export const BUBBLE_MARGIN = 12;
export const BUBBLE_MAX_WIDTH = 360;
export const ARROW_GAP = 12;
export const ARROW_EDGE = 20;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** A highlighted item can be shown when it has a size and most of it is on the screen. */
export const isUsable = (r: Rect | null | undefined, screen: Size): boolean => {
  // (a plain boolean, not a type guard: a rect that is not usable is still a rect)
  if (!r || !(r.width > 0) || !(r.height > 0)) return false;
  const visibleW = Math.min(r.x + r.width, screen.width) - Math.max(r.x, 0);
  const visibleH = Math.min(r.y + r.height, screen.height) - Math.max(r.y, 0);
  return visibleW >= r.width * 0.8 && visibleH >= r.height * 0.8;
};

/** The highlight, a little bigger than the item and kept on the screen. */
export const padRect = (r: Rect, pad: number, screen: Size): Rect => {
  const x = Math.max(0, r.x - pad);
  const y = Math.max(0, r.y - pad);
  const right = Math.min(screen.width, r.x + r.width + pad);
  const bottom = Math.min(screen.height, r.y + r.height + pad);
  return { x, y, width: right - x, height: bottom - y };
};

/** The four dimmed rectangles (above, below, left, right) that leave the highlighted item uncovered. */
export const dimRects = (hole: Rect, screen: Size): Rect[] => {
  const holeBottom = hole.y + hole.height;
  const holeRight = hole.x + hole.width;
  return [
    { x: 0, y: 0, width: screen.width, height: hole.y },
    { x: 0, y: holeBottom, width: screen.width, height: screen.height - holeBottom },
    { x: 0, y: hole.y, width: hole.x, height: hole.height },
    { x: holeRight, y: hole.y, width: screen.width - holeRight, height: hole.height },
  ].filter((r) => r.width > 0 && r.height > 0);
};

export interface BubblePlacement {
  top: number;
  left: number;
  width: number;
  /** The bubble sits below the item with the arrow on its top edge ('up'), or above with the arrow on its bottom edge ('down'). */
  arrow: 'up' | 'down';
  /** Distance of the arrow's centre from the bubble's left edge. */
  arrowLeft: number;
}

/**
 * Below the item when it fits, otherwise above, otherwise null (the caller then shows a centred card).
 * The bubble is as wide as the screen allows up to BUBBLE_MAX_WIDTH, centred on the item and kept on screen;
 * the arrow still points at the item's centre.
 */
export const placeBubble = (hole: Rect, screen: Size, bubbleHeight: number): BubblePlacement | null => {
  const width = Math.min(BUBBLE_MAX_WIDTH, screen.width - 2 * BUBBLE_MARGIN);
  if (width <= 0) return null;
  const below = screen.height - (hole.y + hole.height) - ARROW_GAP - BUBBLE_MARGIN;
  const above = hole.y - ARROW_GAP - BUBBLE_MARGIN;
  let arrow: 'up' | 'down';
  let top: number;
  if (below >= bubbleHeight) {
    arrow = 'up';
    top = hole.y + hole.height + ARROW_GAP;
  } else if (above >= bubbleHeight) {
    arrow = 'down';
    top = hole.y - ARROW_GAP - bubbleHeight;
  } else {
    return null;
  }
  const centre = hole.x + hole.width / 2;
  const left = clamp(centre - width / 2, BUBBLE_MARGIN, screen.width - BUBBLE_MARGIN - width);
  return { top, left, width, arrow, arrowLeft: clamp(centre - left, ARROW_EDGE, width - ARROW_EDGE) };
};
