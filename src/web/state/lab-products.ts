import { useCallback, useEffect, useState } from 'react';
import type { MediumProduct, VesselProduct } from '../../shared/lab-products';
import { api } from '../api';

let vessels: Promise<VesselProduct[]> | null = null;
let media: Promise<MediumProduct[]> | null = null;
const listeners = new Set<() => void>();

/** Products (built-in references + user vessels), fetched once until invalidated. */
export function loadVesselProducts(): Promise<VesselProduct[]> {
  if (!vessels) {
    const pending = api<VesselProduct[]>('/api/lab-products/vessels');
    pending.catch(() => {
      if (vessels === pending) vessels = null;
    });
    vessels = pending;
  }
  return vessels;
}
export function loadMediumProducts(): Promise<MediumProduct[]> {
  if (!media) {
    const pending = api<MediumProduct[]>('/api/lab-products/media');
    pending.catch(() => {
      if (media === pending) media = null;
    });
    media = pending;
  }
  return media;
}
/** Drop cached lists after any product CRUD so every open picker refetches. */
export function invalidateLabProducts(): void {
  vessels = null;
  media = null;
  for (const notify of listeners) notify();
}

function useProducts<T>(load: () => Promise<T[]>): { items: T[] | null; error: string | null; reload(): void } {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    listeners.add(bump);
    return () => void listeners.delete(bump);
  }, []);
  useEffect(() => {
    let live = true;
    load().then(
      (list) => {
        if (live) {
          setItems(list);
          setError(null);
        }
      },
      (e: Error) => {
        if (live) setError(e.message);
      },
    );
    return () => {
      live = false;
    };
  }, [load, tick]);
  return { items, error, reload: useCallback(() => setTick((n) => n + 1), []) };
}
export const useVesselProducts = () => useProducts(loadVesselProducts);
export const useMediumProducts = () => useProducts(loadMediumProducts);
