import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { Restaurant, RestaurantFormData } from '../types/restaurant';
import {
  getRestaurantOperatingProfile,
  RestaurantOperatingProfile
} from '../config/restaurantOperatingModes';
import {
  getRestaurantById,
  getRestaurantsForUser,
  createDefaultRestaurant,
  updateRestaurantProfile
} from '../services/restaurantService';
import {
  getUserProfile,
  updateUserProfileRestaurantId
} from '../services/authService';
import { staffService } from '../services/staffService';
import { syncPublicRestaurantProfile } from '../services/customerDiscoveryService';
import { auth, db } from '../config/firebase';
import { doc, getDoc, collectionGroup, getDocs, query, where } from 'firebase/firestore';
import { StaffRole } from '../types/auth';

interface RestaurantContextType {
  restaurant: Restaurant | null;
  operatingProfile: RestaurantOperatingProfile;
  loading: boolean;
  error: string | null;
  hasNoRestaurant: boolean;
  isCreatingRestaurant: boolean;
  createOwnerRestaurant: (restaurantName?: string, city?: string) => Promise<Restaurant>;
  updateSettings: (data: Partial<RestaurantFormData>) => Promise<void>;
  formatPrice: (amount: number) => string;
  retry: () => void;
  availableRestaurants: Restaurant[];
  switchRestaurant: (restaurantId: string) => Promise<void>;
  loadAvailableRestaurants: () => Promise<Restaurant[]>;
  isSwitching: boolean;
}

const RestaurantContext = createContext<RestaurantContextType | undefined>(undefined);

export const RestaurantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, setProfile } = useAuth();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [hasNoRestaurant, setHasNoRestaurant] = useState<boolean>(false);
  const [isCreatingRestaurant, setIsCreatingRestaurant] = useState<boolean>(false);
  const [retryTrigger, setRetryTrigger] = useState<number>(0);
  const createPromiseRef = React.useRef<Promise<Restaurant> | null>(null);

  // Phase 5C States
  const [availableRestaurants, setAvailableRestaurants] = useState<Restaurant[]>([]);
  const [activeRestaurantId, setActiveRestaurantId] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState<boolean>(false);

  const retry = () => setRetryTrigger((c) => c + 1);

  // Helper to fetch all available restaurants for the user in a secure, non-blocking way
  const fetchAvailableRestaurants = async (userId: string, profileRestId?: string): Promise<Restaurant[]> => {
    const discovered = new Map<string, Restaurant>();

    // 1. Fetch owned restaurants
    try {
      const owned = await getRestaurantsForUser(userId);
      owned.forEach(r => discovered.set(r.restaurantId, r));
    } catch (err) {
      console.warn('[RestaurantOS Debug] Failed to fetch owned restaurants:', err);
    }

    // 2. Fetch profile restaurant
    if (profileRestId && !discovered.has(profileRestId)) {
      try {
        const r = await getRestaurantById(profileRestId);
        if (r) discovered.set(r.restaurantId, r);
      } catch (err) {
        console.warn('[RestaurantOS Debug] Failed to fetch profile restaurant:', err);
      }
    }

    // 3. Collection Group query on 'members' to discover staff roles in other restaurants
    try {
      const q = query(
        collectionGroup(db, 'members'),
        where('userId', '==', userId),
        where('isActive', '==', true)
      );
      const snap = await getDocs(q);
      const memberRestIds: string[] = [];
      snap.forEach(docSnap => {
        const data = docSnap.data();
        if (data.restaurantId && data.isActive === true && data.status !== 'inactive') {
          memberRestIds.push(data.restaurantId);
        }
      });

      await Promise.all(
        memberRestIds.map(async (rid) => {
          if (!discovered.has(rid)) {
            try {
              const r = await getRestaurantById(rid);
              if (r) discovered.set(rid, r);
            } catch (err) {
              console.warn(`[RestaurantOS Debug] Failed to fetch member restaurant ${rid}:`, err);
            }
          }
        })
      );
    } catch (err) {
      console.log('[RestaurantOS Debug] Collection group query for memberships skipped or requires index:', err);
    }

    return Array.from(discovered.values());
  };

  const switchRestaurant = async (newId: string) => {
    if (!user) throw new Error('Unauthenticated');
    setIsSwitching(true);
    try {
      console.log('[RestaurantOS Debug] Initiating switch to restaurant:', newId);
      const found = await getRestaurantById(newId);
      if (!found) {
        throw new Error('Restaurant not found or inaccessible.');
      }

      let activeRole: StaffRole = 'owner';
      if (found.ownerId !== user.uid) {
        const memberRef = doc(db, 'restaurants', found.restaurantId, 'members', user.uid);
        const memberSnap = await getDoc(memberRef);
        if (memberSnap.exists()) {
          const memberData = memberSnap.data();
          const isActive = memberData.isActive !== false && memberData.status !== 'inactive';
          if (isActive) {
            activeRole = memberData.role as StaffRole;
          } else {
            throw new Error('Access Denied: Your staff membership is inactive or disabled.');
          }
        } else {
          throw new Error('Access Denied: You do not have permission to access this restaurant.');
        }
      }

      // Persist selection to localStorage & Firestore profile
      try {
        localStorage.setItem(`restaurantos_restaurant_id_${user.uid}`, found.restaurantId);
      } catch {}

      try {
        await updateUserProfileRestaurantId(user.uid, found.restaurantId);
      } catch (linkErr) {
        console.warn('[RestaurantOS Debug] Failed to persist restaurantId link to profile:', linkErr);
      }

      // Update active states
      setActiveRestaurantId(found.restaurantId);
      setRestaurant(found);
      setError(null);

      // Update role and restaurantId in AuthContext profile
      setProfile((prev) => {
        if (prev) {
          return {
            ...prev,
            restaurantId: found.restaurantId,
            role: activeRole
          };
        }
        return {
          userId: user.uid,
          displayName: user.displayName || user.email?.split('@')[0] || 'Staff',
          email: user.email || '',
          photoUrl: user.photoURL || null,
          role: activeRole,
          restaurantId: found.restaurantId
        };
      });

      console.log('[RestaurantOS Debug] Switch complete. Current active role:', activeRole);
    } catch (err: any) {
      console.error('[RestaurantOS Debug] Failed to switch restaurant:', err);
      throw err;
    } finally {
      setIsSwitching(false);
    }
  };

  useEffect(() => {
    let isCancelled = false;

    const initRestaurant = async () => {
      if (!user) {
        setRestaurant(null);
        setAvailableRestaurants([]);
        setActiveRestaurantId(null);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      console.log('[RestaurantOS Debug] Auth user detected:', {
        authUid: user.uid,
        email: user.email,
        displayName: user.displayName || profile?.displayName || null,
        isAnonymous: user.isAnonymous ?? false
      });

      const ownerName = profile?.displayName || user.displayName || 'Owner';
      let resolvedRestaurant: Restaurant | null = null;
      let readErrorEncountered: string | null = null;
      let verifiedProfile = profile;

      try {
        // -------------------------------------------------------------
        // Strategy 1: Cached local pointer for this authenticated user (HINT ONLY)
        // Never trusted for authorization - must verify existence and membership from Firestore
        // -------------------------------------------------------------
        const cachedRestaurantId = localStorage.getItem(`restaurantos_restaurant_id_${user.uid}`);
        if (cachedRestaurantId) {
          console.log('[RestaurantOS Debug] Strategy 1: Checking cached restaurantId in localStorage:', cachedRestaurantId);
          try {
            const found = await getRestaurantById(cachedRestaurantId);
            if (found) {
              let hasAccess =
                found.ownerId === user.uid
                || (
                  found.provisioningType === 'initial_owner'
                  && found.createdBy === user.uid
                );
              if (!hasAccess) {
                try {
                  const memberRef = doc(db, 'restaurants', found.restaurantId, 'members', user.uid);
                  const memberSnap = await getDoc(memberRef);
                  if (memberSnap.exists()) {
                    const memberData = memberSnap.data();
                    if (memberData.isActive !== false && memberData.status !== 'inactive') {
                      hasAccess = true;
                    }
                  }
                } catch (memberErr) {
                  console.warn('[RestaurantOS Debug] Failed to check member access for cached restaurant:', memberErr);
                }
              }

              if (hasAccess) {
                resolvedRestaurant = found;
                console.log('[RestaurantOS Debug] Successfully verified and resolved restaurant via cached ID:', {
                  restaurantId: resolvedRestaurant.restaurantId,
                  name: resolvedRestaurant.name,
                  docPath: `restaurants/${resolvedRestaurant.restaurantId}`,
                  ownerId: resolvedRestaurant.ownerId
                });
              } else {
                console.warn('[RestaurantOS Debug] Cached restaurantId belongs to different owner/inaccessible. Invalidating cache.');
                try {
                  localStorage.removeItem(`restaurantos_restaurant_id_${user.uid}`);
                } catch {}
              }
            } else {
              // Pointed to non-existent document
              try {
                localStorage.removeItem(`restaurantos_restaurant_id_${user.uid}`);
              } catch {}
            }
          } catch (cacheErr: any) {
            console.warn('[RestaurantOS Debug] Cached restaurantId lookup failed:', cacheErr);
            if (cacheErr?.message && !cacheErr.message.includes('not found')) {
              readErrorEncountered = cacheErr.message;
            }
          }
        }

        // -------------------------------------------------------------
        // Strategy 2: Check user profile in Firestore for existing restaurantId
        // Must verify that document exists and belongs to authenticated user/member
        // -------------------------------------------------------------
        if (!resolvedRestaurant) {
          let targetRestaurantId = profile?.restaurantId;
          if (!targetRestaurantId) {
            try {
              const freshProfile = await getUserProfile(user.uid);
              verifiedProfile = freshProfile;
              if (freshProfile?.restaurantId) {
                targetRestaurantId = freshProfile.restaurantId;
              }
            } catch (profErr: any) {
              console.warn('[RestaurantOS Debug] Could not fetch fresh user profile:', profErr);
              if (profErr?.message) readErrorEncountered = profErr.message;
            }
          }

          if (targetRestaurantId) {
            console.log('[RestaurantOS Debug] Strategy 2: Looking up restaurant from user profile restaurantId:', targetRestaurantId);
            try {
              const found = await getRestaurantById(targetRestaurantId);
              if (found) {
                let hasAccess =
                found.ownerId === user.uid
                || (
                  found.provisioningType === 'initial_owner'
                  && found.createdBy === user.uid
                );
                if (!hasAccess) {
                  try {
                    const memberRef = doc(db, 'restaurants', found.restaurantId, 'members', user.uid);
                    const memberSnap = await getDoc(memberRef);
                    if (memberSnap.exists()) {
                      const memberData = memberSnap.data();
                      if (memberData.isActive !== false && memberData.status !== 'inactive') {
                        hasAccess = true;
                      }
                    }
                  } catch (memberErr) {
                    console.warn('[RestaurantOS Debug] Failed to check member access for profile restaurant:', memberErr);
                  }
                }

                if (hasAccess) {
                  resolvedRestaurant = found;
                  console.log('[RestaurantOS Debug] Successfully verified and resolved restaurant via profile.restaurantId:', {
                    restaurantId: resolvedRestaurant.restaurantId,
                    name: resolvedRestaurant.name,
                    docPath: `restaurants/${resolvedRestaurant.restaurantId}`,
                    ownerId: resolvedRestaurant.ownerId
                  });
                } else {
                  console.warn('[RestaurantOS Debug] Profile restaurantId points to document not accessible by user. Ignoring pointer.');
                }
              }
            } catch (profLookupErr: any) {
              console.warn('[RestaurantOS Debug] Profile restaurantId lookup error:', profLookupErr);
              if (profLookupErr?.message) readErrorEncountered = profLookupErr.message;
            }
          }
        }

        // -------------------------------------------------------------
        // Strategy 3: Check direct deterministic document paths
        // (Direct getDoc lookup - does not require collection list query permissions)
        // -------------------------------------------------------------
        if (!resolvedRestaurant) {
          const sanitizeId = user.uid.toLowerCase().replace(/[^a-z0-9]/g, '_');
          const deterministicDocId = `rest_init_${sanitizeId}`;
          console.log('[RestaurantOS Debug] Strategy 3: Checking direct deterministic paths:', deterministicDocId, `restaurants/${user.uid}`);
          try {
            const byInitDoc = await getRestaurantById(deterministicDocId);
            if (
              byInitDoc
              && (
                byInitDoc.ownerId === user.uid
                || (
                  byInitDoc.provisioningType === 'initial_owner'
                  && byInitDoc.createdBy === user.uid
                )
              )
            ) {
              resolvedRestaurant = byInitDoc;
            } else {
              const byUidRest = await getRestaurantById(user.uid);
              if (
                byUidRest
                && (
                  byUidRest.ownerId === user.uid
                  || (
                    byUidRest.provisioningType === 'initial_owner'
                    && byUidRest.createdBy === user.uid
                  )
                )
              ) {
                resolvedRestaurant = byUidRest;
              }
            }
            if (resolvedRestaurant) {
              console.log('[RestaurantOS Debug] Successfully resolved restaurant via direct deterministic document:', {
                restaurantId: resolvedRestaurant.restaurantId,
                name: resolvedRestaurant.name,
                docPath: `restaurants/${resolvedRestaurant.restaurantId}`,
                ownerId: resolvedRestaurant.ownerId
              });
            }
          } catch (byUidErr: any) {
            console.warn('[RestaurantOS Debug] Direct document lookup error (non-fatal):', byUidErr);
          }
        }

        // -------------------------------------------------------------
        // Strategy 4: Query restaurants collection for ownerId == user.uid
        // (Safely isolated in try/catch so list-permission errors do not crash resolution)
        // -------------------------------------------------------------
        if (!resolvedRestaurant) {
          console.log('[RestaurantOS Debug] Strategy 4: Querying restaurants collection where ownerId ==', user.uid);
          try {
            const ownedList = await getRestaurantsForUser(user.uid);
            console.log('[RestaurantOS Debug] Strategy 4: getRestaurantsForUser returned count:', ownedList.length);
            if (ownedList && ownedList.length > 0) {
              resolvedRestaurant = ownedList[0];
              console.log('[RestaurantOS Debug] Successfully resolved restaurant via ownerId query:', {
                restaurantId: resolvedRestaurant.restaurantId,
                name: resolvedRestaurant.name,
                docPath: `restaurants/${resolvedRestaurant.restaurantId}`,
                ownerId: resolvedRestaurant.ownerId
              });
            }
          } catch (queryErr: any) {
            console.warn('[RestaurantOS Debug] Strategy 4: Collection list query error:', queryErr);
          }
        }

        // -------------------------------------------------------------
        // Strategy 4B: Staff membership discovery across restaurants
        // -------------------------------------------------------------
        if (!resolvedRestaurant) {
          console.log('[RestaurantOS Debug] Strategy 4B: Discovering staff memberships for user:', user.uid);
          try {
            const staffMembership = await staffService.findStaffMembershipForUser(user.uid, user.email);
            if (staffMembership) {
              const found = await getRestaurantById(staffMembership.restaurantId);
              if (found) {
                resolvedRestaurant = found;
                console.log('[RestaurantOS Debug] Successfully resolved restaurant via active staff membership:', {
                  restaurantId: resolvedRestaurant.restaurantId,
                  name: resolvedRestaurant.name,
                  role: staffMembership.role
                });
              }
            }
          } catch (staffFindErr: any) {
            console.warn('[RestaurantOS Debug] Strategy 4B: Staff membership lookup error:', staffFindErr);
          }
        }

        // -------------------------------------------------------------
        // DUPLICATE RESTAURANT PROTECTION & STRICT PROOF CHECK:
        // A customer or staff member must NEVER automatically create a restaurant!
        // -------------------------------------------------------------
        if (!resolvedRestaurant) {
          if (readErrorEncountered) {
            throw new Error(`Cannot verify existing restaurant due to Firestore error: ${readErrorEncountered}`);
          }

          // Check if user has an inactive / deactivated membership in any restaurant
          const hasInactiveMembership = await staffService.checkIfUserHasInactiveMembership(user.uid, user.email);
          if (hasInactiveMembership) {
            throw new Error('Access Denied: Your staff membership is inactive or disabled.');
          }

          // If user profile has an explicit staff role (non-owner)
          if (verifiedProfile?.role && verifiedProfile.role !== 'owner') {
            throw new Error(
              'Access Denied: Your staff account is not linked to an active restaurant. Please contact the restaurant owner.'
            );
          }

          // Check if user's email was registered or invited as staff anywhere
          const isStaffUser = await staffService.checkIfEmailIsStaff(user.email);
          if (isStaffUser) {
            throw new Error(
              'Access Denied: Your staff account is not linked to an active restaurant. Please contact the restaurant owner.'
            );
          }

          // Strict Security Invariant:
          // A customer authentication must NEVER automatically become a restaurant owner.
          // Clean absence of restaurant -> Await explicit owner onboarding action in UI.
          console.log('[RestaurantOS Security] User has no existing restaurant ownership or staff membership. Strict Security Invariant: Customer accounts NEVER auto-create restaurants.', {
            authUid: user.uid,
            userEmail: user.email
          });

          if (isCancelled) return;
          setRestaurant(null);
          setActiveRestaurantId(null);
          setHasNoRestaurant(true);
          setAvailableRestaurants([]);
          setError(null);
          setLoading(false);
          return;
        }

        setHasNoRestaurant(false);

        // Persist the resolved restaurant ID to both localStorage and Firestore profile
        if (resolvedRestaurant) {
          // Repair legacy first-login owner bootstrap before any nested collection
          // is accessed. This is safe because createDefaultRestaurant() only
          // self-heals an initial_owner document whose createdBy already equals
          // the authenticated UID.
          if (
            resolvedRestaurant.provisioningType === 'initial_owner'
            && resolvedRestaurant.createdBy === user.uid
            && resolvedRestaurant.ownerId !== user.uid
          ) {
            try {
              resolvedRestaurant = await createDefaultRestaurant(
                user.uid,
                user.email || '',
                ownerName,
                resolvedRestaurant.name,
                resolvedRestaurant.city
              );
              console.log('[RestaurantOS Owner Bootstrap] Reconciled legacy owner authorization:', {
                restaurantId: resolvedRestaurant.restaurantId,
                ownerId: resolvedRestaurant.ownerId
              });
            } catch (repairErr) {
              console.warn('[RestaurantOS Owner Bootstrap] Owner authorization repair warning:', repairErr);
            }
          }

          let activeRole: StaffRole = 'owner';
          const isLegacyInitialOwner =
            resolvedRestaurant.provisioningType === 'initial_owner'
            && resolvedRestaurant.createdBy === user.uid;

          if (resolvedRestaurant.ownerId !== user.uid && !isLegacyInitialOwner) {
            const memberRef = doc(db, 'restaurants', resolvedRestaurant.restaurantId, 'members', user.uid);
            const memberSnap = await getDoc(memberRef);
            if (memberSnap.exists()) {
              const memberData = memberSnap.data();
              const isActive = memberData.isActive !== false && memberData.status !== 'inactive';
              if (isActive) {
                activeRole = memberData.role as StaffRole;
              } else {
                throw new Error('Access Denied: Your staff membership is inactive or disabled.');
              }
            } else {
              throw new Error('Access Denied: You do not have permission to access this restaurant.');
            }
          }

          try {
            localStorage.setItem(`restaurantos_restaurant_id_${user.uid}`, resolvedRestaurant.restaurantId);
          } catch {}

          // Avoid a Firestore write when the profile already points to the
          // resolved restaurant. Only repair the link when it is actually stale.
          if (verifiedProfile?.restaurantId !== resolvedRestaurant.restaurantId) {
            try {
              await updateUserProfileRestaurantId(user.uid, resolvedRestaurant.restaurantId);
            } catch (linkErr) {
              console.warn('[RestaurantOS Debug] Failed to persist restaurantId link to profile:', linkErr);
            }
          }

          setProfile((prev) => {
            if (prev && prev.role === activeRole && prev.restaurantId === resolvedRestaurant?.restaurantId) return prev;
            if (prev) return { ...prev, role: activeRole, restaurantId: resolvedRestaurant?.restaurantId };
            return {
              userId: user.uid,
              displayName: user.displayName || user.email?.split('@')[0] || 'Staff',
              email: user.email || '',
              photoUrl: user.photoURL || null,
              role: activeRole,
              restaurantId: resolvedRestaurant?.restaurantId
            };
          });
        }

        if (isCancelled) return;

        // Set states
        setRestaurant(resolvedRestaurant);
        setActiveRestaurantId(resolvedRestaurant.restaurantId);
        setError(null);

        // Do not enumerate all owned/staff restaurants during bootstrap.
        // The active restaurant alone is enough for the first page render.
        setAvailableRestaurants([resolvedRestaurant]);

        console.log('[RestaurantOS Debug] Final restaurant paths initialized:', {
          authUid: user.uid,
          userEmail: user.email,
          resolvedRestaurantId: resolvedRestaurant.restaurantId,
          restaurantDocPath: `restaurants/${resolvedRestaurant.restaurantId}`
        });

      } catch (err: any) {
        if (isCancelled) return;
        console.error('[RestaurantOS Debug] Failed to resolve restaurant from Firestore:', err);
        setRestaurant(null);
        setActiveRestaurantId(null);
        setHasNoRestaurant(false);

        let rawMsg = err?.message || 'Failed to load restaurant profile from Firestore';
        const jsonMatch = rawMsg.match(/\{[\s\S]*\}/);
        let displayError = rawMsg;
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.error) displayError = parsed.error;
          } catch {}
        }
        setError(displayError);
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    initRestaurant();

    return () => {
      isCancelled = true;
    };
  }, [user, profile?.restaurantId, profile?.role, retryTrigger]);

  /**
   * Explicit Owner Onboarding Action.
   * MUST only be called when the authenticated user explicitly clicks "Create Restaurant" in the UI.
   * Fully protected against race conditions, duplicate calls, and existing restaurant collisions.
   */
  const createOwnerRestaurant = React.useCallback(
    async (restaurantName?: string, city?: string): Promise<Restaurant> => {
      if (!user) throw new Error('You must be signed in to create a restaurant.');

      // In-flight mutex / promise deduplication
      if (createPromiseRef.current) {
        return createPromiseRef.current;
      }

      setIsCreatingRestaurant(true);
      setError(null);

      const promise = (async () => {
        try {
          console.log('[RestaurantOS Security] Explicit owner onboarding requested by user:', user.uid);
          const ownerName = user.displayName || user.email?.split('@')[0] || 'Restaurant Owner';

          // Transaction-level idempotency & duplicate protection in service layer
          const newRest = await createDefaultRestaurant(
            user.uid,
            user.email || '',
            ownerName,
            restaurantName,
            city
          );

          setRestaurant(newRest);
          setActiveRestaurantId(newRest.restaurantId);
          setHasNoRestaurant(false);
          setError(null);

          // Update AuthContext profile with owner role and restaurantId
          setProfile((prev) => {
            if (prev) {
              return { ...prev, role: 'owner', restaurantId: newRest.restaurantId };
            }
            return {
              userId: user.uid,
              displayName: ownerName,
              email: user.email || '',
              photoUrl: user.photoURL || null,
              role: 'owner',
              restaurantId: newRest.restaurantId
            };
          });

          // Sync public discovery projection
          syncPublicRestaurantProfile(newRest).catch((syncErr) => {
            console.warn('[RestaurantOS Discovery] Public profile sync notice on manual create:', syncErr);
          });

          setAvailableRestaurants([newRest]);

          return newRest;
        } catch (createErr: any) {
          console.error('[RestaurantOS Security] Failed to create owner restaurant:', createErr);
          const msg = createErr?.message || 'Failed to create restaurant. Please try again.';
          setError(msg);
          throw createErr;
        } finally {
          setIsCreatingRestaurant(false);
          createPromiseRef.current = null;
        }
      })();

      createPromiseRef.current = promise;
      return promise;
    },
    [user, setProfile]
  );

  const updateSettings = React.useCallback(async (data: Partial<RestaurantFormData>) => {
    if (!restaurant) throw new Error('No active restaurant');
    try {
      await updateRestaurantProfile(restaurant.restaurantId, data);
      setRestaurant((prev) => (prev ? { ...prev, ...data } : prev));
    } catch (err) {
      setRestaurant((prev) => (prev ? { ...prev, ...data } : prev));
      throw err;
    }
  }, [restaurant]);

  const loadAvailableRestaurants = React.useCallback(async (): Promise<Restaurant[]> => {
    if (!user) return [];
    const list = await fetchAvailableRestaurants(
      user.uid,
      profile?.restaurantId || activeRestaurantId || restaurant?.restaurantId
    );
    setAvailableRestaurants(list);
    return list;
  }, [user, profile?.restaurantId, activeRestaurantId, restaurant?.restaurantId]);

  const formatPrice = React.useCallback((amount: number) => {
    const symbol = restaurant?.currencySymbol || '₹';
    return `${symbol}${Number(amount || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }, [restaurant?.currencySymbol]);

  const operatingProfile = React.useMemo(() => {
    return getRestaurantOperatingProfile(restaurant);
  }, [restaurant]);

  const value = React.useMemo(() => ({
    restaurant,
    operatingProfile,
    loading,
    error,
    hasNoRestaurant,
    isCreatingRestaurant,
    createOwnerRestaurant,
    updateSettings,
    formatPrice,
    retry,
    availableRestaurants,
    switchRestaurant,
    loadAvailableRestaurants,
    isSwitching
  }), [
    restaurant,
    operatingProfile,
    loading,
    error,
    hasNoRestaurant,
    isCreatingRestaurant,
    createOwnerRestaurant,
    updateSettings,
    formatPrice,
    availableRestaurants,
    switchRestaurant,
    loadAvailableRestaurants,
    isSwitching
  ]);

  return (
    <RestaurantContext.Provider value={value}>
      {children}
    </RestaurantContext.Provider>
  );
};

export function useRestaurant() {
  const context = useContext(RestaurantContext);
  if (!context) {
    return {
      restaurant: null,
      operatingProfile: getRestaurantOperatingProfile(null),
      loading: false,
      error: null,
      hasNoRestaurant: false,
      isCreatingRestaurant: false,
      createOwnerRestaurant: async () => { throw new Error('RestaurantProvider missing'); },
      retry: () => {},
      categories: [],
      menuItems: [],
      activeMenuItems: [],
      tables: [],
      getCategoryName: () => '',
      getItem: () => null,
      updateSettings: async () => {},
      formatPrice: (m: number) => `₹${m / 100}`,
      availableRestaurants: [],
      switchRestaurant: async () => {},
      loadAvailableRestaurants: async () => [],
      isSwitching: false
    };
  }
  return context;
}
