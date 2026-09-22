import {
  collection,
  query,
  orderBy,
  getDocs,
  getDocsFromCache,
  onSnapshot
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { Category, MenuItem } from '../types/menu';

function isTestRuntime(): boolean {
  return typeof import.meta !== 'undefined'
    && Boolean((import.meta as any).env?.MODE === 'test');
}

const publicMenuCache = new Map<string, PublicMenuData>();

function clonePublicMenu(menu: PublicMenuData): PublicMenuData {
  return {
    ...menu,
    categories: menu.categories.map((item) => ({ ...item })),
    allItems: menu.allItems.map((item) => ({ ...item })),
    itemsByCategory: Object.fromEntries(
      Object.entries(menu.itemsByCategory).map(([key, items]) => [key, items.map((item) => ({ ...item }))])
    )
  };
}

export interface PublicMenuData {
  restaurantId: string;
  categories: Category[];
  itemsByCategory: Record<string, MenuItem[]>;
  allItems: MenuItem[];
  totalActiveItems: number;
}

/**
 * Organizes raw categories and items into an authoritative, tenant-isolated public menu structure.
 * Filters out inactive categories and ensures items are properly mapped.
 */
export function organizePublicMenu(
  restaurantId: string,
  rawCategories: Category[],
  rawItems: MenuItem[]
): PublicMenuData {
  // 1. Filter and sort active categories
  const activeCategories = rawCategories
    .filter((c) => c.isActive !== false)
    .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));

  const validCategoryIds = new Set(activeCategories.map((c) => c.categoryId));

  // 2. Sort items and group under active categories
  const sortedItems = [...rawItems].sort(
    (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)
  );

  const itemsByCategory: Record<string, MenuItem[]> = {};
  activeCategories.forEach((c) => {
    itemsByCategory[c.categoryId] = [];
  });

  const visibleItems: MenuItem[] = [];

  sortedItems.forEach((item) => {
    if (validCategoryIds.has(item.categoryId)) {
      const publicItem: MenuItem = {
        ...item,
        isOnlineAvailable: item.isOnlineAvailable !== false
      };
      itemsByCategory[item.categoryId].push(publicItem);
      visibleItems.push(publicItem);
    }
  });

  return {
    restaurantId,
    categories: activeCategories,
    itemsByCategory,
    allItems: visibleItems,
    totalActiveItems: visibleItems.length
  };
}

/**
 * Fetches the public menu for a specific restaurant once.
 * Strictly guarantees tenant isolation by scoping Firestore queries to `restaurants/{restaurantId}/*`.
 */
export async function fetchPublicMenu(restaurantId: string): Promise<PublicMenuData> {
  const cleanId = (restaurantId || '').trim();
  if (!cleanId) {
    return {
      restaurantId: '',
      categories: [],
      itemsByCategory: {},
      allItems: [],
      totalActiveItems: 0
    };
  }

  try {
    if (!isTestRuntime()) {
      const cached = publicMenuCache.get(cleanId);
      if (cached) return clonePublicMenu(cached);
    }

    const categoriesRef = collection(db, 'restaurants', cleanId, 'categories');
    const itemsRef = collection(db, 'restaurants', cleanId, 'items');

    const categoryQuery = query(categoriesRef, orderBy('sortOrder', 'asc'));
    const itemQuery = query(itemsRef, orderBy('sortOrder', 'asc'));

    let categoriesSnap: any = null;
    let itemsSnap: any = null;

    if (!isTestRuntime()) {
      try {
        [categoriesSnap, itemsSnap] = await Promise.all([
          getDocsFromCache(categoryQuery),
          getDocsFromCache(itemQuery)
        ]);
      } catch {
        categoriesSnap = null;
        itemsSnap = null;
      }
    }

    if (!categoriesSnap || !itemsSnap || categoriesSnap.empty || itemsSnap.empty) {
      [categoriesSnap, itemsSnap] = await Promise.all([
        getDocs(categoryQuery),
        getDocs(itemQuery)
      ]);
    }

    const categories: Category[] = [];
    categoriesSnap.forEach((docSnap) => {
      categories.push({
        categoryId: docSnap.id,
        restaurantId: cleanId,
        ...(docSnap.data() as Omit<Category, 'categoryId' | 'restaurantId'>)
      });
    });

    const items: MenuItem[] = [];
    itemsSnap.forEach((docSnap) => {
      items.push({
        itemId: docSnap.id,
        restaurantId: cleanId,
        ...(docSnap.data() as Omit<MenuItem, 'itemId' | 'restaurantId'>)
      });
    });

    const result = organizePublicMenu(cleanId, categories, items);
    if (!isTestRuntime()) publicMenuCache.set(cleanId, result);
    return clonePublicMenu(result);
  } catch (err) {
    console.warn(`[RestaurantOS Public Menu] Error fetching menu for ${cleanId}:`, err);
    throw err;
  }
}

/**
 * Subscribes to real-time updates for a restaurant's public menu.
 * Ensures that live catalog modifications or availability toggles are immediately reflected.
 */
export function invalidatePublicMenuCache(restaurantId: string): void {
  const cleanId = (restaurantId || '').trim();
  if (cleanId) publicMenuCache.delete(cleanId);
}

export function subscribeToPublicMenu(
  restaurantId: string,
  onUpdate: (menuData: PublicMenuData) => void,
  onError?: (err: unknown) => void
): () => void {
  const cleanId = (restaurantId || '').trim();
  if (!cleanId) {
    onUpdate({
      restaurantId: '',
      categories: [],
      itemsByCategory: {},
      allItems: [],
      totalActiveItems: 0
    });
    return () => {};
  }

  let latestCategories: Category[] = [];
  let latestItems: MenuItem[] = [];
  let categoriesLoaded = false;
  let itemsLoaded = false;

  const updateMenuIfReady = () => {
    if (categoriesLoaded && itemsLoaded) {
      const organized = organizePublicMenu(cleanId, latestCategories, latestItems);
      onUpdate(organized);
    }
  };

  const categoriesRef = collection(db, 'restaurants', cleanId, 'categories');
  const itemsRef = collection(db, 'restaurants', cleanId, 'items');

  const unsubCategories = onSnapshot(
    query(categoriesRef, orderBy('sortOrder', 'asc')),
    (snapshot) => {
      const list: Category[] = [];
      snapshot.forEach((docSnap) => {
        list.push({
          categoryId: docSnap.id,
          restaurantId: cleanId,
          ...(docSnap.data() as Omit<Category, 'categoryId' | 'restaurantId'>)
        });
      });
      latestCategories = list;
      categoriesLoaded = true;
      updateMenuIfReady();
    },
    (err) => {
      console.warn(`[RestaurantOS Public Menu] Error listening to categories for ${cleanId}:`, err);
      if (onError) onError(err);
    }
  );

  const unsubItems = onSnapshot(
    query(itemsRef, orderBy('sortOrder', 'asc')),
    (snapshot) => {
      const list: MenuItem[] = [];
      snapshot.forEach((docSnap) => {
        list.push({
          itemId: docSnap.id,
          restaurantId: cleanId,
          ...(docSnap.data() as Omit<MenuItem, 'itemId' | 'restaurantId'>)
        });
      });
      latestItems = list;
      itemsLoaded = true;
      updateMenuIfReady();
    },
    (err) => {
      console.warn(`[RestaurantOS Public Menu] Error listening to items for ${cleanId}:`, err);
      if (onError) onError(err);
    }
  );

  return () => {
    unsubCategories();
    unsubItems();
  };
}
