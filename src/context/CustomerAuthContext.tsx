import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { CustomerProfile, CustomerAddress } from '../types/customer';
import {
  subscribeToCustomerAuth,
  loginCustomerWithGoogle,
  logoutCustomer,
  getCustomerProfile,
  provisionCustomerProfile,
  updateCustomerProfile,
  formatCustomerAuthError
} from '../services/customerAuthService';

export interface CustomerAuthContextType {
  customer: CustomerProfile | null;
  firebaseUser: FirebaseUser | null;
  isLoading: boolean;
  isSigningIn: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<CustomerProfile | null>;
  signOut: () => Promise<void>;
  updateProfile: (updates: {
    name?: string;
    phone?: string;
    addresses?: CustomerAddress[];
  }) => Promise<CustomerProfile>;
  clearAuthError: () => void;
  refreshProfile: () => Promise<void>;
}

const CustomerAuthContext = createContext<CustomerAuthContextType | undefined>(undefined);

export const CustomerAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Synchronize customer profile with Firebase Auth state
  useEffect(() => {
    let isMounted = true;

    const unsubscribe = subscribeToCustomerAuth(async (user) => {
      if (!isMounted) return;
      setFirebaseUser(user);

      if (user) {
        try {
          // Attempt to load existing profile or provision if absent
          let profile = await getCustomerProfile(user.uid);
          if (!profile) {
            profile = await provisionCustomerProfile(user);
          }
          if (isMounted) {
            setCustomer(profile);
          }
        } catch (err) {
          console.warn('[CustomerAuthContext] Failed to load/provision customer profile:', err);
          // If Firestore read fails due to temporary permissions or network, create a local fallback from auth user
          if (isMounted) {
            setCustomer({
              customerId: user.uid,
              name: user.displayName || user.email?.split('@')[0] || 'Customer',
              email: user.email || '',
              phone: user.phoneNumber || '',
              photoURL: user.photoURL || null,
              authProvider: 'google.com',
              addresses: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
          }
        }
      } else {
        if (isMounted) {
          setCustomer(null);
        }
      }

      if (isMounted) {
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<CustomerProfile | null> => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const { user, profile } = await loginCustomerWithGoogle();
      setFirebaseUser(user);
      setCustomer(profile);
      return profile;
    } catch (err: any) {
      const friendlyMsg = err?.message || formatCustomerAuthError(err);
      setAuthError(friendlyMsg);
      throw err;
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await logoutCustomer();
      setCustomer(null);
      setFirebaseUser(null);
      setAuthError(null);
    } catch (err: any) {
      setAuthError(err.message || 'Failed to sign out.');
      throw err;
    }
  }, []);

  const updateProfile = useCallback(
    async (updates: {
      name?: string;
      phone?: string;
      addresses?: CustomerAddress[];
    }): Promise<CustomerProfile> => {
      if (!customer?.customerId) {
        throw new Error('You must be signed in to update your profile.');
      }
      try {
        const updated = await updateCustomerProfile(customer.customerId, updates);
        setCustomer(updated);
        return updated;
      } catch (err: any) {
        const msg = err.message || 'Failed to update profile.';
        setAuthError(msg);
        throw err;
      }
    },
    [customer?.customerId]
  );

  const refreshProfile = useCallback(async (): Promise<void> => {
    if (!firebaseUser?.uid) return;
    try {
      const p = await getCustomerProfile(firebaseUser.uid);
      if (p) {
        setCustomer(p);
      }
    } catch (err) {
      console.warn('[CustomerAuthContext] Failed to refresh profile:', err);
    }
  }, [firebaseUser?.uid]);

  return (
    <CustomerAuthContext.Provider
      value={{
        customer,
        firebaseUser,
        isLoading,
        isSigningIn,
        authError,
        signInWithGoogle,
        signOut,
        updateProfile,
        clearAuthError,
        refreshProfile
      }}
    >
      {children}
    </CustomerAuthContext.Provider>
  );
};

export function useCustomerAuth(): CustomerAuthContextType {
  const context = useContext(CustomerAuthContext);
  if (!context) {
    return {
      customer: null,
      firebaseUser: null,
      isLoading: false,
      isSigningIn: false,
      authError: null,
      signInWithGoogle: async () => null,
      signOut: async () => {},
      updateProfile: async () => {
        throw new Error('CustomerAuthProvider missing');
      },
      clearAuthError: () => {},
      refreshProfile: async () => {}
    };
  }
  return context;
}
