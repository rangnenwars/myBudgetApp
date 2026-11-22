import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { View, ViewProps } from 'react-native';
import type { Rect } from '../utils/tourSpotlight';

// The guided tour points at real things on Home. Each of them says "I am the item called X" here, and the tour
// asks where X is on the screen. Outside the tour this does nothing.

interface TourTargetsValue {
  register: (id: string, ref: React.RefObject<View | null>) => () => void;
  /** Whether something is registered under this name right now (a hidden feature registers nothing). */
  has: (id: string) => boolean;
  /** Where it is in the window, or null when it is not there or cannot be measured. */
  measure: (id: string) => Promise<Rect | null>;
  /** Home gives the tour a way to scroll it, so an item below the fold can be brought into view. */
  setScroller: (scrollBy: ((dy: number) => void) | null) => void;
  scrollBy: (dy: number) => boolean;
}

const none: TourTargetsValue = {
  register: () => () => {},
  has: () => false,
  measure: async () => null,
  setScroller: () => {},
  scrollBy: () => false,
};

const Ctx = createContext<TourTargetsValue>(none);

export const TourTargetsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const targets = useRef(new Map<string, React.RefObject<View | null>>());
  const scroller = useRef<((dy: number) => void) | null>(null);

  const register = useCallback((id: string, ref: React.RefObject<View | null>) => {
    targets.current.set(id, ref);
    return () => {
      if (targets.current.get(id) === ref) targets.current.delete(id);
    };
  }, []);
  const has = useCallback((id: string) => !!targets.current.get(id)?.current, []);
  const measure = useCallback(
    (id: string) =>
      new Promise<Rect | null>((resolve) => {
        const node = targets.current.get(id)?.current;
        if (!node || typeof node.measureInWindow !== 'function') return resolve(null);
        try {
          node.measureInWindow((x, y, width, height) => resolve([x, y, width, height].every((n) => Number.isFinite(n)) ? { x, y, width, height } : null));
        } catch {
          resolve(null);
        }
      }),
    []
  );
  const setScroller = useCallback((fn: ((dy: number) => void) | null) => {
    scroller.current = fn;
  }, []);
  const scrollBy = useCallback((dy: number) => {
    if (!scroller.current) return false;
    scroller.current(dy);
    return true;
  }, []);

  const value = useMemo(() => ({ register, has, measure, setScroller, scrollBy }), [register, has, measure, setScroller, scrollBy]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useTourTargets = (): TourTargetsValue => useContext(Ctx);

/** Mark an existing element as a tour target: attach the returned ref to it. */
export const useTourTarget = (id: string): React.RefObject<View | null> => {
  const { register } = useTourTargets();
  const ref = useRef<View | null>(null);
  useEffect(() => register(id, ref), [id, register]);
  return ref;
};

/** Mark a block as a tour target without changing how it is laid out. */
export const TourTarget: React.FC<{ id: string; children: React.ReactNode; style?: ViewProps['style'] }> = ({ id, children, style }) => {
  const ref = useTourTarget(id);
  return (
    <View ref={ref} collapsable={false} style={style}>
      {children}
    </View>
  );
};
