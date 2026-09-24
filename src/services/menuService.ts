import {
  collection,
  doc,
  getDocs,
  getDocsFromCache,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { Category, CategoryFormData, MenuItem, MenuItemFormData } from '../types/menu';
import { handleFirestoreError, OperationType } from '../utils/firestoreError';
import { enforcePermission } from '../utils/permissions';

function isTestRuntime(): boolean {
  return typeof import.meta !== 'undefined'
    && Boolean((import.meta as any).env?.MODE === 'test');
}

const categoryCache = new Map<string, Category[]>();
const menuItemCache = new Map<string, MenuItem[]>();

function cloneCachedList<T>(items: T[]): T[] {
  return items.map((item) => ({ ...item } as T));
}

async function readCollectionOnce<T>(
  collectionRef: any,
  buildItem: (id: string, data: any) => T,
  cache: Map<string, T[]>,
  cacheKey: string,
  forceRefresh = false
): Promise<T[]> {
  if (!forceRefresh && !isTestRuntime()) {
    const cached = cache.get(cacheKey);
    if (cached) return cloneCachedList(cached);
  }

  const q = query(collectionRef, orderBy('sortOrder', 'asc'));
  let snapshot: any = null;

  // Prefer the local persistent Firestore cache. This avoids a billed backend
  // read when the collection is already present in the browser cache.
  if (!forceRefresh && !isTestRuntime()) {
    try {
      snapshot = await getDocsFromCache(q);
    } catch {
      snapshot = null;
    }
  }

  if (!snapshot || snapshot.empty) {
    snapshot = await getDocs(q);
  }

  const list: T[] = [];
  snapshot.forEach((d: any) => list.push(buildItem(d.id, d.data())));
  if (!isTestRuntime()) cache.set(cacheKey, list);
  return cloneCachedList(list);
}

export async function getCategoriesOnce(restaurantId: string, forceRefresh = false): Promise<Category[]> {
  const cleanId = (restaurantId || '').trim();
  if (!cleanId) return [];
  const colRef = collection(db, 'restaurants', cleanId, 'categories');
  return readCollectionOnce(
    colRef,
    (id, data) => ({ categoryId: id, restaurantId: cleanId, ...data } as Category),
    categoryCache,
    cleanId,
    forceRefresh
  );
}

export async function getMenuItemsOnce(restaurantId: string, forceRefresh = false): Promise<MenuItem[]> {
  const cleanId = (restaurantId || '').trim();
  if (!cleanId) return [];
  const colRef = collection(db, 'restaurants', cleanId, 'items');
  return readCollectionOnce(
    colRef,
    (id, data) => ({ itemId: id, restaurantId: cleanId, ...data } as MenuItem),
    menuItemCache,
    cleanId,
    forceRefresh
  );
}

export function invalidateMenuCache(restaurantId: string): void {
  const cleanId = (restaurantId || '').trim();
  if (!cleanId) return;
  categoryCache.delete(cleanId);
  menuItemCache.delete(cleanId);
}



// -------------------------------------------------------------
// CATEGORIES
// -------------------------------------------------------------

export function subscribeToCategories(
  restaurantId: string,
  callback: (categories: Category[]) => void,
  onError?: (err: unknown) => void
) {
  const colRef = collection(db, 'restaurants', restaurantId, 'categories');
const q = query(colRef, orderBy('sortOrder', 'asc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: Category[] = [];
      snapshot.forEach((d) => {
        list.push({ categoryId: d.id, ...d.data() } as Category);
      });
      callback(list);
    },
    (err) => {
      if (!auth.currentUser) {
        console.log('[RestaurantOS Debug] Categories snapshot listener ended after auth logout');
        return;
      }
      console.error('[RestaurantOS Debug] Error listening to categories:', err);
      if (onError) onError(err);
    }
  );
}

export async function createCategory(
  restaurantId: string,
  data: CategoryFormData
): Promise<string> {
  await enforcePermission(restaurantId, 'access_categories');
  try {
    const colRef = collection(db, 'restaurants', restaurantId, 'categories');
    const newDoc = doc(colRef);

    const category: Category = {
      categoryId: newDoc.id,
      restaurantId,
      name: data.name.trim(),
      description: data.description.trim(),
      imageUrl: data.imageUrl || null,
      sortOrder: Number(data.sortOrder) || 0,
      isActive: data.isActive !== undefined ? data.isActive : true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(newDoc, category);
    invalidateMenuCache(restaurantId);
    return newDoc.id;
  } catch (error) {
    throw handleFirestoreError(error, OperationType.CREATE, `restaurants/${restaurantId}/categories`);
  }
}

export async function updateCategory(
  restaurantId: string,
  categoryId: string,
  data: Partial<CategoryFormData>
): Promise<void> {
  await enforcePermission(restaurantId, 'access_categories');
  try {
    const ref = doc(db, 'restaurants', restaurantId, 'categories', categoryId);
    await updateDoc(ref, {
      ...data,
      updatedAt: serverTimestamp()
    });
    invalidateMenuCache(restaurantId);
  } catch (error) {
    throw handleFirestoreError(error, OperationType.UPDATE, `restaurants/${restaurantId}/categories/${categoryId}`);
  }
}

export async function deleteCategory(
  restaurantId: string,
  categoryId: string
): Promise<void> {
  await enforcePermission(restaurantId, 'access_categories');
  try {
    const ref = doc(db, 'restaurants', restaurantId, 'categories', categoryId);
    await deleteDoc(ref);
    invalidateMenuCache(restaurantId);
  } catch (error) {
    throw handleFirestoreError(error, OperationType.DELETE, `restaurants/${restaurantId}/categories/${categoryId}`);
  }
}

export async function toggleCategoryStatus(
  restaurantId: string,
  categoryId: string,
  isActive: boolean
): Promise<void> {
  await enforcePermission(restaurantId, 'access_categories');
  try {
    const ref = doc(db, 'restaurants', restaurantId, 'categories', categoryId);
    await updateDoc(ref, {
      isActive,
      updatedAt: serverTimestamp()
    });
    invalidateMenuCache(restaurantId);
  } catch (error) {
    throw handleFirestoreError(error, OperationType.UPDATE, `restaurants/${restaurantId}/categories/${categoryId}`);
  }
}

/**
 * Swaps or updates sort orders for two adjacent categories.
 */
export async function swapCategoryOrder(
  restaurantId: string,
  catA: { categoryId: string; sortOrder: number },
  catB: { categoryId: string; sortOrder: number }
): Promise<void> {
  try {
    const refA = doc(db, 'restaurants', restaurantId, 'categories', catA.categoryId);
    const refB = doc(db, 'restaurants', restaurantId, 'categories', catB.categoryId);
    
    const orderA = catA.sortOrder === catB.sortOrder ? catA.sortOrder : catB.sortOrder;
    const orderB = catA.sortOrder === catB.sortOrder ? catA.sortOrder + 1 : catA.sortOrder;

    await Promise.all([
      updateDoc(refA, { sortOrder: orderA, updatedAt: serverTimestamp() }),
      updateDoc(refB, { sortOrder: orderB, updatedAt: serverTimestamp() })
    ]);
    invalidateMenuCache(restaurantId);
  } catch (error) {
    throw handleFirestoreError(error, OperationType.UPDATE, `restaurants/${restaurantId}/categories`);
  }
}

// -------------------------------------------------------------
// MENU ITEMS
// -------------------------------------------------------------

export function subscribeToMenuItems(
  restaurantId: string,
  callback: (items: MenuItem[]) => void,
  onError?: (err: unknown) => void
) {
  const colRef = collection(db, 'restaurants', restaurantId, 'items');
  const q = query(colRef, orderBy('sortOrder', 'asc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: MenuItem[] = [];
      snapshot.forEach((d) => {
        list.push({ itemId: d.id, ...d.data() } as MenuItem);
      });
      callback(list);
    },
    (err) => {
      if (!auth.currentUser) {
        console.log('[RestaurantOS Debug] Menu items snapshot listener ended after auth logout');
        return;
      }
      console.error('[RestaurantOS Debug] Error listening to items:', err);
      if (onError) onError(err);
    }
  );
}

export async function createMenuItem(
  restaurantId: string,
  data: MenuItemFormData
): Promise<string> {
  await enforcePermission(restaurantId, 'access_items');
  try {
    const colRef = collection(db, 'restaurants', restaurantId, 'items');
    const newDoc = doc(colRef);

    const item: MenuItem = {
      itemId: newDoc.id,
      restaurantId,
      categoryId: data.categoryId,
      name: data.name.trim(),
      shortName: data.shortName.trim() || data.name.trim().slice(0, 16),
      description: data.description.trim(),
      imageUrl: data.imageUrl || null,
      price: Math.max(0, Number(data.price) || 0),
      taxRate: Math.max(0, Number(data.taxRate) || 0),
      taxInclusive: !!data.taxInclusive,
      foodType: data.foodType || 'veg',
      isAvailable: data.isAvailable !== undefined ? data.isAvailable : true,
      isOnlineAvailable: data.isOnlineAvailable !== false,
      sku: data.sku?.trim() || '',
      sortOrder: Number(data.sortOrder) || 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(newDoc, item);
    invalidateMenuCache(restaurantId);
    return newDoc.id;
  } catch (error) {
    throw handleFirestoreError(error, OperationType.CREATE, `restaurants/${restaurantId}/items`);
  }
}

export async function updateMenuItem(
  restaurantId: string,
  itemId: string,
  data: Partial<MenuItemFormData>
): Promise<void> {
  await enforcePermission(restaurantId, 'access_items');
  try {
    const ref = doc(db, 'restaurants', restaurantId, 'items', itemId);
    const payload: any = {
      ...data,
      updatedAt: serverTimestamp()
    };
    if (data.price !== undefined) {
      payload.price = Math.max(0, Number(data.price));
    }
    if (data.taxRate !== undefined) {
      payload.taxRate = Math.max(0, Number(data.taxRate));
    }
    await updateDoc(ref, payload);
    invalidateMenuCache(restaurantId);
  } catch (error) {
    throw handleFirestoreError(error, OperationType.UPDATE, `restaurants/${restaurantId}/items/${itemId}`);
  }
}

export async function deleteMenuItem(
  restaurantId: string,
  itemId: string
): Promise<void> {
  await enforcePermission(restaurantId, 'access_items');
  try {
    const ref = doc(db, 'restaurants', restaurantId, 'items', itemId);
    await deleteDoc(ref);
    invalidateMenuCache(restaurantId);
  } catch (error) {
    throw handleFirestoreError(error, OperationType.DELETE, `restaurants/${restaurantId}/items/${itemId}`);
  }
}

export async function toggleItemAvailability(
  restaurantId: string,
  itemId: string,
  isAvailable: boolean
): Promise<void> {
  await enforcePermission(restaurantId, 'access_items');
  try {
    const ref = doc(db, 'restaurants', restaurantId, 'items', itemId);
    await updateDoc(ref, {
      isAvailable,
      updatedAt: serverTimestamp()
    });
    invalidateMenuCache(restaurantId);
  } catch (error) {
    throw handleFirestoreError(error, OperationType.UPDATE, `restaurants/${restaurantId}/items/${itemId}`);
  }
}

export async function toggleItemOnlineAvailability(
  restaurantId: string,
  itemId: string,
  isOnlineAvailable: boolean
): Promise<void> {
  const cleanRestaurantId = restaurantId?.trim();
  const cleanItemId = itemId?.trim();
  if (!cleanRestaurantId || !cleanItemId) {
    throw new Error('restaurantId and itemId are required to update online item availability.');
  }

  const isTestRuntime = typeof import.meta !== 'undefined'
    && Boolean((import.meta as any).env?.MODE === 'test');

  if (typeof window !== 'undefined' && !isTestRuntime) {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Authentication is required to update online item availability.');

    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/menu-items/toggle-online-availability', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        restaurantId: cleanRestaurantId,
        itemId: cleanItemId,
        isOnlineAvailable
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.message || 'Failed to update online item availability.');
    }

    invalidateMenuCache(cleanRestaurantId);
    return;
  }

  await enforcePermission(cleanRestaurantId, 'access_items');
  try {
    const ref = doc(db, 'restaurants', cleanRestaurantId, 'items', cleanItemId);
    await updateDoc(ref, {
      isOnlineAvailable,
      updatedAt: serverTimestamp()
    });
    invalidateMenuCache(cleanRestaurantId);
  } catch (error) {
    throw handleFirestoreError(error, OperationType.UPDATE, `restaurants/${cleanRestaurantId}/items/${cleanItemId}`);
  }
}

export const menuService = {
  subscribeToCategories,
  getCategoriesOnce,
  createCategory,
  updateCategory,
  deleteCategory,
  swapCategoryOrder,
  subscribeToMenuItems,
  getMenuItemsOnce,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  toggleItemAvailability,
  toggleItemOnlineAvailability,
  invalidateMenuCache
};

