import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OwnerCentralPage } from '../pages/OwnerCentralPage';
import { Restaurant } from '../types/restaurant';

const { mockDBState, mockAuthHolder, mockLogout } = vi.hoisted(() => {
  return {
    mockDBState: {
      restaurants: new Map<string, any>(),
      users: new Map<string, any>(),
      members: new Map<string, any>(),
      reset() {
        this.restaurants.clear();
        this.users.clear();
        this.members.clear();
      }
    },
    mockAuthHolder: {
      currentUser: {
        uid: 'cust_user_12345',
        email: 'customer.alice@gmail.com',
        displayName: 'Alice Customer',
        photoURL: null
      } as any,
      currentProfile: null as any
    },
    mockLogout: vi.fn()
  };
});

vi.mock('../config/firebase', () => ({
  auth: {
    get currentUser() {
      return mockAuthHolder.currentUser;
    },
    onAuthStateChanged: vi.fn((cb) => {
      cb(mockAuthHolder.currentUser);
      return () => {};
    }),
    signOut: vi.fn()
  },
  db: { type: 'mockDb' }
}));

vi.mock('../context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../context/AuthContext')>();
  return {
    ...actual,
    useAuth: () => ({
      user: mockAuthHolder.currentUser,
      profile: mockAuthHolder.currentProfile,
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      loginGoogle: vi.fn(),
      logout: mockLogout,
      setProfile: vi.fn((updater) => {
        if (typeof updater === 'function') {
          mockAuthHolder.currentProfile = updater(mockAuthHolder.currentProfile);
        } else {
          mockAuthHolder.currentProfile = updater;
        }
      }),
      redirectError: null,
      clearRedirectError: vi.fn()
    })
  };
});

vi.mock('firebase/firestore', () => {
  return {
    collection: vi.fn((_db, ...pathSegments) => ({ type: 'collection', path: pathSegments.join('/') })),
    collectionGroup: vi.fn((_db, colName) => ({ type: 'collectionGroup', colName })),
    doc: vi.fn((_dbOrCol, ...pathSegments) => {
      const id = pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : `mock_doc_${Math.random().toString(36).substring(2, 10)}`;
      const path = pathSegments.length > 0 ? pathSegments.join('/') : `restaurants/${id}`;
      return { id, path };
    }),
    getDoc: vi.fn(async (docRef: any) => {
      const path = docRef.path || '';
      if (path.startsWith('restaurants/') && !path.includes('/members/')) {
        const id = docRef.id;
        const exists = mockDBState.restaurants.has(id);
        const data = exists ? mockDBState.restaurants.get(id) : undefined;
        return { exists: () => exists, id, data: () => data };
      }
      if (path.startsWith('users/')) {
        const id = docRef.id;
        const exists = mockDBState.users.has(id);
        const data = exists ? mockDBState.users.get(id) : undefined;
        return { exists: () => exists, id, data: () => data };
      }
      if (path.includes('/members/')) {
        const id = docRef.id;
        const exists = mockDBState.members.has(id);
        const data = exists ? mockDBState.members.get(id) : undefined;
        return { exists: () => exists, id, data: () => data };
      }
      return { exists: () => false, id: docRef.id, data: () => undefined };
    }),
    getDocs: vi.fn(async (queryOrCol: any) => {
      const list: any[] = [];
      const queryWhere = queryOrCol?.clauses?.[0];
      mockDBState.restaurants.forEach((r, id) => {
        if (!queryWhere || r.ownerId === queryWhere.val) {
          list.push({ id, data: () => r });
        }
      });
      return {
        docs: list,
        empty: list.length === 0,
        size: list.length,
        forEach: (cb: any) => list.forEach(cb)
      };
    }),
    setDoc: vi.fn(async (docRef: any, data: any, options?: any) => {
      const path = docRef.path || '';
      const id = docRef.id;
      if (path.startsWith('restaurants/') && !path.includes('/members/')) {
        const existing = options?.merge ? mockDBState.restaurants.get(id) || {} : {};
        mockDBState.restaurants.set(id, { ...existing, ...data, restaurantId: id });
      } else if (path.startsWith('users/')) {
        const existing = options?.merge ? mockDBState.users.get(id) || {} : {};
        mockDBState.users.set(id, { ...existing, ...data });
      }
    }),
    updateDoc: vi.fn(async (docRef: any, data: any) => {
      const path = docRef.path || '';
      const id = docRef.id;
      if (path.startsWith('restaurants/')) {
        const existing = mockDBState.restaurants.get(id) || {} as any;
        mockDBState.restaurants.set(id, { ...existing, ...data });
      } else if (path.startsWith('users/')) {
        const existing = mockDBState.users.get(id) || {};
        mockDBState.users.set(id, { ...existing, ...data });
      }
    }),
    query: vi.fn((colRef: any, ...clauses: any[]) => ({ type: 'query', colRef, clauses })),
    where: vi.fn((field: string, op: string, val: any) => ({ type: 'where', field, op, val })),
    orderBy: vi.fn((field: string, dir?: string) => ({ type: 'orderBy', field, dir })),
    limit: vi.fn((n: number) => ({ type: 'limit', count: n })),
    serverTimestamp: vi.fn(() => 'MOCK_TIMESTAMP'),
    onSnapshot: vi.fn(() => vi.fn()),
    runTransaction: vi.fn(async (_db: any, callback: any) => {
      const tx = {
        get: async (docRef: any) => {
          const path = docRef.path || '';
          const id = docRef.id;
          if (path.startsWith('restaurants/')) {
            const exists = mockDBState.restaurants.has(id);
            const data = exists ? mockDBState.restaurants.get(id) : undefined;
            return { exists: () => exists, id, data: () => data };
          }
          if (path.startsWith('users/')) {
            const exists = mockDBState.users.has(id);
            const data = exists ? mockDBState.users.get(id) : undefined;
            return { exists: () => exists, id, data: () => data };
          }
          return { exists: () => false, id: data => undefined };
        },
        set: (docRef: any, data: any, options?: any) => {
          const path = docRef.path || '';
          const id = docRef.id;
          if (path.startsWith('restaurants/')) {
            const existing = options?.merge ? mockDBState.restaurants.get(id) || {} : {};
            mockDBState.restaurants.set(id, { ...existing, ...data, restaurantId: id });
          } else if (path.startsWith('users/')) {
            const existing = options?.merge ? mockDBState.users.get(id) || {} : {};
            mockDBState.users.set(id, { ...existing, ...data });
          }
        },
        update: (docRef: any, data: any) => {
          const path = docRef.path || '';
          const id = docRef.id;
          if (path.startsWith('restaurants/')) {
            const existing = mockDBState.restaurants.get(id) || {} as any;
            mockDBState.restaurants.set(id, { ...existing, ...data });
          }
        }
      };
      return callback(tx);
    })
  };
});

describe('CRITICAL REGRESSION SUITE: Customer Account NEVER Auto-Creates Restaurant', () => {
  beforeEach(() => {
    mockDBState.reset();
    vi.clearAllMocks();
    localStorage.clear();
    window.location.hash = '#owner';
    mockAuthHolder.currentUser = {
      uid: 'cust_user_12345',
      email: 'customer.alice@gmail.com',
      displayName: 'Alice Customer',
      photoURL: null
    };
    mockAuthHolder.currentProfile = null;
  });

  it('Scenario 1 & 2: New customer navigates to Owner Central → ZERO restaurants auto-created in Firestore', async () => {
    render(<OwnerCentralPage />);

    // Wait for resolution to finish
    await waitFor(() => {
      expect(screen.getByText('Create Your Restaurant')).toBeInTheDocument();
    });

    // Invariant: mockDBState.restaurants MUST be empty!
    expect(mockDBState.restaurants.size).toBe(0);
    expect(screen.getByText(/Owner Onboarding/i)).toBeInTheDocument();
    expect(screen.getByText(/Customer accounts are completely separate from Restaurant Owner accounts/i)).toBeInTheDocument();
  });

  it('Scenario 3: Displays identity context and asks if user wants to create a restaurant', async () => {
    render(<OwnerCentralPage />);

    await waitFor(() => {
      expect(screen.getByText('Create Your Restaurant')).toBeInTheDocument();
    });

    expect(screen.getByText(/Signed in as:/i)).toBeInTheDocument();
    expect(screen.getByText(/Alice Customer/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Yes, Create My Restaurant/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel & Back to Customer Front Door/i })).toBeInTheDocument();
  });

  it('Scenario 4: Customer clicks "Cancel & Back to Customer Front Door" → Zero writes, returns to customer door', async () => {
    render(<OwnerCentralPage />);

    await waitFor(() => {
      expect(screen.getByText('Create Your Restaurant')).toBeInTheDocument();
    });

    const cancelBtn = screen.getByRole('button', { name: /Cancel & Back to Customer Front Door/i });
    fireEvent.click(cancelBtn);

    expect(window.location.hash).toBe('#discover');
    expect(mockDBState.restaurants.size).toBe(0);
  });

  it('Scenario 5: Customer clicks "Sign Out & Switch Account" → Logs out cleanly without creating restaurant', async () => {
    render(<OwnerCentralPage />);

    await waitFor(() => {
      expect(screen.getByText('Create Your Restaurant')).toBeInTheDocument();
    });

    const signOutBtn = screen.getByRole('button', { name: /Sign Out & Switch Account/i });
    fireEvent.click(signOutBtn);

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockDBState.restaurants.size).toBe(0);
  });

  it('Scenario 6: User explicitly submits "Yes, Create My Restaurant" → Creates single restaurant with user-specified name', async () => {
    render(<OwnerCentralPage />);

    await waitFor(() => {
      expect(screen.getByText('Create Your Restaurant')).toBeInTheDocument();
    });

    const nameInput = screen.getByLabelText(/Restaurant Name/i);
    const cityInput = screen.getByLabelText(/City/i);

    fireEvent.change(nameInput, { target: { value: 'Alice Royal Diner' } });
    fireEvent.change(cityInput, { target: { value: 'Raichur' } });

    const createBtn = screen.getByRole('button', { name: /Yes, Create My Restaurant/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(mockDBState.restaurants.size).toBe(1);
    });

    const createdRest = Array.from(mockDBState.restaurants.values())[0];
    expect(createdRest.name).toBe('Alice Royal Diner');
    expect(createdRest.city).toBe('Raichur');
    expect(createdRest.ownerId).toBe('cust_user_12345');
  });

  it('Scenario 7: Existing restaurant owner visiting Owner Central → Opens existing restaurant immediately without creating duplicate', async () => {
    const existingRestId = 'rest_existing_owner_001';
    const existingRest: Restaurant = {
      restaurantId: existingRestId,
      name: 'Grand Sagar Cafe',
      legalName: 'Grand Sagar Cafe LLP',
      logoUrl: null,
      phone: '+91 99999 88888',
      email: 'owner.bob@gmail.com',
      address: 'MG Road',
      city: 'Raichur',
      state: 'Karnataka',
      postalCode: '584101',
      country: 'India',
      gstNumber: '29ABCDE1234F1Z5',
      currency: 'INR',
      currencySymbol: '₹',
      timezone: 'Asia/Kolkata',
      taxMode: 'exclusive',
      defaultTaxRate: 5.0,
      ownerId: 'owner_bob_999',
      provisioningType: 'initial_owner',
      createdBy: 'owner_bob_999',
      isActive: true,
      restaurantOperatingMode: 'full_service',
      restaurantCapabilities: {} as any,
      createdAt: 'MOCK_TIMESTAMP' as any,
      updatedAt: 'MOCK_TIMESTAMP' as any
    };

    mockDBState.restaurants.set(existingRestId, existingRest);
    mockDBState.users.set('owner_bob_999', { restaurantId: existingRestId, role: 'owner' });

    mockAuthHolder.currentUser = {
      uid: 'owner_bob_999',
      email: 'owner.bob@gmail.com',
      displayName: 'Bob Owner',
      photoURL: null
    };
    mockAuthHolder.currentProfile = {
      userId: 'owner_bob_999',
      displayName: 'Bob Owner',
      email: 'owner.bob@gmail.com',
      role: 'owner',
      restaurantId: existingRestId
    };

    render(<OwnerCentralPage />);

    // Invariant: should NOT show onboarding screen
    await waitFor(() => {
      expect(screen.queryByText('Create Your Restaurant')).not.toBeInTheDocument();
    });

    // Invariant: database still has exactly 1 restaurant (no duplicate created!)
    expect(mockDBState.restaurants.size).toBe(1);
  });
});
