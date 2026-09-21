import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  runTransaction
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { Restaurant, RestaurantFormData } from '../types/restaurant';
import { FULL_SERVICE_CAPABILITIES } from '../config/restaurantOperatingModes';
import { handleFirestoreError, OperationType } from '../utils/firestoreError';
import { enforcePermission } from '../utils/permissions';
import { syncPublicRestaurantProfile } from './customerDiscoveryService';

export async function getRestaurantById(restaurantId: string): Promise<Restaurant | null> {
  console.log('[RestaurantOS Debug] getRestaurantById lookup:', {
    restaurantId,
    docPath: `restaurants/${restaurantId}`
  });
  try {
    const ref = doc(db, 'restaurants', restaurantId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      console.log('[RestaurantOS Debug] getRestaurantById document not found:', `restaurants/${restaurantId}`);
      return null;
    }
    const data = { restaurantId: snap.id, ...snap.data() } as Restaurant;
    console.log('[RestaurantOS Debug] getRestaurantById found restaurant:', {
      restaurantId: data.restaurantId,
      name: data.name,
      ownerId: data.ownerId
    });
    return data;
  } catch (error: any) {
    // In Firestore security rules (allow read: if resource.data.ownerId == request.auth.uid),
    // looking up a non-existent document or a document owned by another user returns 'permission-denied'
    // because resource is null on non-existent documents. Treat permission-denied as not found.
    if (error?.code === 'permission-denied') {
      console.log('[RestaurantOS Debug] getRestaurantById: document non-existent or inaccessible for current user:', `restaurants/${restaurantId}`);
      return null;
    }
    console.error('[RestaurantOS Debug] getRestaurantById error on path:', `restaurants/${restaurantId}`, error);
    throw handleFirestoreError(error, OperationType.GET, `restaurants/${restaurantId}`);
  }
}

export async function getRestaurantsForUser(userId: string): Promise<Restaurant[]> {
  if (!auth.currentUser) {
    console.warn('[RestaurantOS Debug] getRestaurantsForUser called without active auth user');
    return [];
  }

  console.log('[RestaurantOS Debug] getRestaurantsForUser query:', {
    collection: 'restaurants',
    queryFilter: `ownerId == ${userId}`,
    authUid: auth.currentUser.uid
  });

  try {
    const q = query(
      collection(db, 'restaurants'),
      where('ownerId', '==', userId)
    );
    const snap = await getDocs(q);
    const list: Restaurant[] = [];
    snap.forEach((d) => {
      list.push({ restaurantId: d.id, ...d.data() } as Restaurant);
    });
    console.log('[RestaurantOS Debug] getRestaurantsForUser result count:', list.length, 'restaurants:', list.map(r => ({ id: r.restaurantId, name: r.name })));
    return list;
  } catch (error: any) {
    // If collection listing is restricted by Firestore security rules, log as non-blocking warning and return empty list
    if (error?.code === 'permission-denied') {
      console.warn('[RestaurantOS Debug] getRestaurantsForUser query not permitted by current Firestore rules. Falling back to direct user profile pointer.');
      return [];
    }
    console.error('[RestaurantOS Debug] getRestaurantsForUser error on query:', error);
    throw handleFirestoreError(error, OperationType.LIST, 'restaurants');
  }
}

async function ensureOwnerMembership(restaurant: Restaurant, userId: string, ownerEmail: string, ownerName: string): Promise<void> {
  if (!restaurant?.restaurantId) return;

  // Self-heal only when Firestore itself establishes that this authenticated
  // user is the original owner. This keeps the client from ever claiming an
  // unrelated restaurant while repairing legacy owner/member bootstrap data.
  const canBootstrapOwner =
    restaurant.ownerId === userId
    || (
      restaurant.provisioningType === 'initial_owner'
      && restaurant.createdBy === userId
    );

  if (!canBootstrapOwner) return;

  try {
    const restaurantRef = doc(db, 'restaurants', restaurant.restaurantId);

    // Legacy initial-owner documents may have a stale/missing ownerId. The
    // Firestore rules explicitly permit this exact createdBy-based repair.
    if (restaurant.ownerId !== userId && restaurant.provisioningType === 'initial_owner' && restaurant.createdBy === userId) {
      await updateDoc(restaurantRef, {
        ownerId: userId,
        updatedAt: serverTimestamp()
      });
      restaurant.ownerId = userId;
    }

    const memberRef = doc(db, 'restaurants', restaurant.restaurantId, 'members', userId);
    const memberSnap = await getDoc(memberRef);
    const payload = {
      memberId: userId, userId, restaurantId: restaurant.restaurantId, role: 'owner',
      displayName: ownerName || restaurant.name || 'Restaurant Owner',
      email: ownerEmail || restaurant.email || '', isActive: true, status: 'active',
      authLinked: true, updatedAt: serverTimestamp()
    };
    if (memberSnap.exists()) await updateDoc(memberRef, payload);
    else await setDoc(memberRef, { ...payload, createdAt: serverTimestamp() });
  } catch (err) {
    console.warn('[RestaurantOS Owner Bootstrap] Failed to reconcile owner membership:', err);
  }
}

export async function getOrCreateInitialRestaurant(
  userId: string,
  userEmail: string,
  ownerName: string,
  restaurantName?: string,
  city?: string
): Promise<Restaurant> {
  if (!userId) {
    throw new Error('User ID is required for initial restaurant provisioning');
  }

  const cleanOwnerFirstName = ownerName ? ownerName.split(' ')[0] : 'Owner';
  const customRestaurantName = restaurantName?.trim() || `${cleanOwnerFirstName}'s Restaurant`;
  const customCity = city?.trim() || 'Bengaluru';
  const sanitizeId = userId.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const initDocId = `rest_init_${sanitizeId}`;
  const initRestRef = doc(db, 'restaurants', initDocId);
  const userRef = doc(db, 'users', userId);
  const customerRef = doc(db, 'customers', userId);

  // 1. Pre-check: Check if user already owns any restaurant via collection query
  try {
    const existingList = await getRestaurantsForUser(userId);
    if (existingList && existingList.length > 0) {
      const existing = existingList[0];
      console.log('[RestaurantOS Idempotency] Existing owned restaurant found during pre-check:', {
        restaurantId: existing.restaurantId,
        ownerId: userId
      });
      try {
        await setDoc(
          userRef,
          {
            userId,
            restaurantId: existing.restaurantId,
            initialRestaurantId: existing.restaurantId,
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );
      } catch (linkErr) {
        console.warn('[RestaurantOS Idempotency] Failed to reconcile user profile pointer:', linkErr);
      }
      await ensureOwnerMembership(existing, userId, userEmail, ownerName);
      return existing;
    }
  } catch (queryErr) {
    console.warn('[RestaurantOS Idempotency] Pre-check list query warning:', queryErr);
  }

  // 2. Perform atomic, transaction-backed provisioning guard
  try {
    const result = await runTransaction(db, async (transaction) => {
      // Read identity documents before writes so an existing customer profile is
      // atomically blocked when this Firebase UID becomes a restaurant owner.
      const customerSnap = await transaction.get(customerRef);

      // Re-verify user profile
      const userSnap = await transaction.get(userRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        const profileRestId = userData.restaurantId || userData.initialRestaurantId;
        if (profileRestId) {
          const profileRestRef = doc(db, 'restaurants', profileRestId);
          const profileRestSnap = await transaction.get(profileRestRef);
          if (profileRestSnap.exists()) {
            const profileRestData = profileRestSnap.data() as any;

            // Repair a legacy initial-owner record before returning it. Without
            // this, a stale ownerId causes every nested collection read to fail
            // even though the authenticated user originally provisioned it.
            if (
              profileRestData.provisioningType === 'initial_owner'
              && profileRestData.createdBy === userId
              && profileRestData.ownerId !== userId
            ) {
              transaction.update(profileRestRef, {
                ownerId: userId,
                updatedAt: serverTimestamp()
              });
              profileRestData.ownerId = userId;
              console.log('[RestaurantOS Owner Bootstrap] Repaired ownerId from profile-linked initial restaurant:', profileRestId);
            }

            return { restaurantId: profileRestSnap.id, ...profileRestData } as Restaurant;
          }
        }
      }

      // Re-verify deterministic initial restaurant document
      const initRestSnap = await transaction.get(initRestRef);
      if (initRestSnap.exists()) {
        console.log('[RestaurantOS Idempotency] Transaction resolved existing deterministic restaurant document:', initDocId);
        const rawInitData = initRestSnap.data();
        // Legacy bootstrap repair: if this deterministic initial-owner record was created by
        // this same authenticated UID but its ownerId was lost/corrupted, repair only the
        // ownership pointer. The Firestore rule independently requires createdBy +
        // provisioningType to match, so another user cannot claim the record.
        if (rawInitData.provisioningType === 'initial_owner'
          && rawInitData.createdBy === userId
          && rawInitData.ownerId !== userId) {
          transaction.update(initRestRef, { ownerId: userId, updatedAt: serverTimestamp() });
          rawInitData.ownerId = userId;
          console.log('[RestaurantOS Owner Bootstrap] Repaired legacy initial restaurant ownerId:', initDocId);
        }
        const initData = { restaurantId: initRestSnap.id, ...rawInitData } as Restaurant;
        transaction.set(userRef, { userId, restaurantId: initDocId, initialRestaurantId: initDocId }, { merge: true });
        if (customerSnap.exists()) {
          transaction.set(customerRef, {
            accountStatus: 'blocked',
            blockedAt: serverTimestamp(),
            blockedReason: 'restaurant_owner'
          }, { merge: true });
        }
        return initData;
      }

      // Neither exists: atomically create initial owner restaurant
      console.log('[RestaurantOS Idempotency] Transaction creating initial owner restaurant document:', initDocId);
      const newRestaurant: Restaurant = {
        restaurantId: initDocId,
        name: customRestaurantName,
        legalName: `${restaurantName?.trim() || ownerName || 'Owner'} Hospitality LLP`,
        logoUrl: null,
        phone: '+91 98765 43210',
        email: userEmail || 'admin@restaurantos.io',
        address: '124 Prime Market Square, MG Road',
        city: customCity,
        state: 'Karnataka',
        postalCode: '560001',
        country: 'India',
        gstNumber: '29ABCDE1234F1Z5',
        currency: 'INR',
        currencySymbol: '₹',
        timezone: 'Asia/Kolkata',
        taxMode: 'exclusive',
        defaultTaxRate: 5.0,
        ownerId: userId,
        provisioningType: 'initial_owner',
        createdBy: userId,
        isActive: true,
        restaurantOperatingMode: 'full_service',
        restaurantCapabilities: { ...FULL_SERVICE_CAPABILITIES },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      transaction.set(initRestRef, newRestaurant);
      transaction.set(userRef, { userId, restaurantId: initDocId, initialRestaurantId: initDocId }, { merge: true });
      if (customerSnap.exists()) {
        transaction.set(customerRef, {
          accountStatus: 'blocked',
          blockedAt: serverTimestamp(),
          blockedReason: 'restaurant_owner'
        }, { merge: true });
      }

      return newRestaurant;
    });

    await ensureOwnerMembership(result, userId, userEmail, ownerName);

    // Best-effort sync to public discovery projection
    try {
      await syncPublicRestaurantProfile(result);
    } catch (syncErr) {
      console.warn('[RestaurantOS Discovery] Public profile sync warning on initial create/get:', syncErr);
    }

    return result;
  } catch (txErr: any) {
    console.warn('[RestaurantOS Idempotency] Transaction failed or fell back. Re-checking existing documents:', txErr);
    const retrySnap = await getDoc(initRestRef);
    if (retrySnap.exists()) {
      const fallbackRest = { restaurantId: retrySnap.id, ...retrySnap.data() } as Restaurant;
      try {
        await syncPublicRestaurantProfile(fallbackRest);
      } catch (syncErr) {
        console.warn('[RestaurantOS Discovery] Public profile sync warning on retry fallback:', syncErr);
      }
      await ensureOwnerMembership(fallbackRest, userId, userEmail, ownerName);
      return fallbackRest;
    }
    throw handleFirestoreError(txErr, OperationType.CREATE, `restaurants/${initDocId}`);
  }
}

export async function createDefaultRestaurant(
  userId: string,
  userEmail: string,
  ownerName: string,
  restaurantName?: string,
  city?: string
): Promise<Restaurant> {
  return getOrCreateInitialRestaurant(userId, userEmail, ownerName, restaurantName, city);
}

export async function updateRestaurantProfile(
  restaurantId: string,
  data: Partial<RestaurantFormData>
): Promise<void> {
  await enforcePermission(restaurantId, 'access_restaurant_setup');
  try {
    const ref = doc(db, 'restaurants', restaurantId);
    await updateDoc(ref, {
      ...data,
      updatedAt: serverTimestamp()
    });

    // Best-effort sync to public discovery profile
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await syncPublicRestaurantProfile({ restaurantId: snap.id, ...snap.data() } as Restaurant);
      }
    } catch (syncErr) {
      console.warn('[RestaurantOS Discovery] Best-effort public sync warning:', syncErr);
    }
  } catch (error) {
    throw handleFirestoreError(error, OperationType.UPDATE, `restaurants/${restaurantId}`);
  }
}


export function subscribeToRestaurant(
  restaurantId: string,
  callback: (restaurant: Restaurant | null) => void,
  onError?: (err: unknown) => void
) {
  const ref = doc(db, 'restaurants', restaurantId);
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        callback({ restaurantId: snap.id, ...snap.data() } as Restaurant);
      } else {
        callback(null);
      }
    },
    (err) => {
      // In onSnapshot callbacks, throwing an exception crashes the JS runtime as an Uncaught Error.
      // If auth.currentUser is null, the user has logged out or is unauthenticated; absorb cleanly.
      if (!auth.currentUser) {
        console.log('[RestaurantOS Debug] Restaurant snapshot listener ended after auth logout');
        return;
      }
      console.error('[RestaurantOS Debug] Restaurant snapshot error:', err);
      if (onError) onError(err);
    }
  );
}

export async function createRestaurantBranch(
  userId: string,
  userEmail: string,
  branchName: string,
  city: string,
  country: string = 'India'
): Promise<Restaurant> {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Authentication is required to create a restaurant branch.');
    if (userId !== currentUser.uid) throw new Error('Authenticated owner identity does not match the requested user.');
    const cleanBranchName = branchName?.trim();
    const cleanCity = city?.trim();
    const cleanCountry = country?.trim() || 'India';
    if (!cleanBranchName) throw new Error('Branch name is required.');
    if (!cleanCity) throw new Error('City is required.');

    const restaurantRef = doc(collection(db, 'restaurants'));
    const newRestaurant: Restaurant = {
      restaurantId: restaurantRef.id,
      name: cleanBranchName,
      legalName: `${cleanBranchName} Group`,
      logoUrl: null,
      phone: '+91 98765 43210',
      email: userEmail || 'admin@restaurantos.io',
      address: 'Shop 101, Main Street',
      city: cleanCity,
      state: '',
      postalCode: '',
      country: cleanCountry,
      gstNumber: '29ABCDE1234F1Z5',
      currency: 'INR',
      currencySymbol: '₹',
      timezone: 'Asia/Kolkata',
      taxMode: 'exclusive',
      defaultTaxRate: 5.0,
      ownerId: userId,
      provisioningType: 'explicit_outlet',
      createdBy: userId,
      isActive: true,
      restaurantOperatingMode: 'full_service',
      restaurantCapabilities: { ...FULL_SERVICE_CAPABILITIES },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    console.log('[RestaurantOS Debug] createRestaurantBranch writing to path:', `restaurants/${restaurantRef.id}`, {
      restaurantId: restaurantRef.id,
      ownerId: userId,
      provisioningType: 'explicit_outlet'
    });

    await setDoc(restaurantRef, newRestaurant);
    try {
      await syncPublicRestaurantProfile(newRestaurant);
    } catch (syncErr) {
      console.warn('[RestaurantOS Discovery] Best-effort public sync warning on branch create:', syncErr);
    }
    return newRestaurant;

  } catch (error) {
    console.error('[RestaurantOS Debug] createRestaurantBranch error:', error);
    throw handleFirestoreError(error, OperationType.CREATE, 'restaurants');
  }
}
