import type { CatalogCategory, CatalogOption } from '../../shared/catalog';
import { api } from '../api';

const cache = new Map<CatalogCategory, Promise<CatalogOption[]>>();

/** Visible options of a category, fetched once per session until invalidated. */
export function loadCatalog(category: CatalogCategory): Promise<CatalogOption[]> {
  let pending = cache.get(category);
  if (!pending) {
    pending = api<CatalogOption[]>(`/api/catalog?category=${category}`);
    // A failed load must not stick: the next caller retries.
    pending.catch(() => cache.delete(category));
    cache.set(category, pending);
  }
  return pending;
}

/** Drop the cached list after options change (added, hidden, saved through a profile). */
export function invalidateCatalog(category: CatalogCategory): void {
  cache.delete(category);
}
