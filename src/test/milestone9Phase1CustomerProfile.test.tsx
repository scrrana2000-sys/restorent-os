import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';

import {
  formatCustomerAuthError,
  getCustomerProfile,
  provisionCustomerProfile,
  updateCustomerProfile,
  loginCustomerWithGoogle,
  logoutCustomer
} from '../services/customerAuthService';
import { CustomerProfile, CustomerAddress, PublicRestaurantProfile } from '../types/customer';
import { CustomerCheckoutModal } from '../components/customer/CustomerCheckoutModal';
import { CustomerProfileModal } from '../components/customer/CustomerProfileModal';
import { CustomerCartProvider, useCustomerCart } from '../context/CustomerCartContext';
import { CustomerAuthProvider, useCustomerAuth } from '../context/CustomerAuthContext';

// Mocks
vi.mock('../config/firebase', () => ({
  auth: {
    currentUser: null
  },
  db: {}
}));

vi.mock('firebase/auth', () => ({
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: vi.fn().mockImplementation(() => ({
    setCustomParameters: vi.fn()
  })),
  signOut: vi.fn().mockResolvedValue(undefined),
  onAuthStateChanged: vi.fn((_auth, cb) => {
    // Initial mock state: no customer signed in
    cb(null);
    return () => {};
  })
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, coll, id) => ({ path: `${coll}/${id}`, id })),
  getDoc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined)
}));

const mockRestaurantProfile: PublicRestaurantProfile = {
  restaurantId: 'rest_m9_test_1',
  publicSlug: 'spice-junction',
  publicRestaurantCode: 'SJ101',
  name: 'Spice Junction',
  logoUrl: null,
  coverImageUrl: null,
  phone: '9876543210',
  address: 'Station Road',
  city: 'Raichur',
  state: 'Karnataka',
  area: 'Station Area',
  postalCode: '584101',
  country: 'India',
  currency: 'INR',
  currencySymbol: '₹',
  cuisine: ['North Indian', 'Biryani'],
  publicStatus: 'active',
  onlineOrderingEnabled: true,
  takeawayEnabled: true,
  deliveryEnabled: true,
  isOpenNow: true
};

describe('Milestone 9 — Phase 1: Customer Account & Profile Foundation Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // TEST 1 & 2: Guest Checkout Verification
  describe('Guest Checkout Compatibility', () => {
    it('TEST 1: Guest can still access customer checkout modal without signing in', () => {
      render(
        <CustomerAuthProvider>
          <CustomerCartProvider>
            <CustomerCheckoutModal
              isOpen={true}
              onClose={() => {}}
              restaurantProfile={mockRestaurantProfile}
            />
          </CustomerCartProvider>
        </CustomerAuthProvider>
      );

      // Verify checkout modal is rendered with guest-friendly inputs
      expect(screen.getByText(/customer checkout/i)).toBeDefined();
      expect(screen.getByPlaceholderText(/e\.g\. Rahul Sharma/i)).toBeDefined();
      expect(screen.getByPlaceholderText(/9876543210/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /review order/i })).toBeDefined();
    });

    it('TEST 2: Guest checkout input validation works correctly for guest users', () => {
      render(
        <CustomerAuthProvider>
          <CustomerCartProvider>
            <CustomerCheckoutModal
              isOpen={true}
              onClose={() => {}}
              restaurantProfile={mockRestaurantProfile}
            />
          </CustomerCartProvider>
        </CustomerAuthProvider>
      );

      const reviewBtn = screen.getByRole('button', { name: /review order/i });
      fireEvent.click(reviewBtn);

      // Both name and phone errors should be flagged when empty
      expect(screen.getByText(/customer name is required/i)).toBeDefined();
      expect(screen.getByText(/valid mobile phone number is required/i)).toBeDefined();
    });
  });

  // TEST 3, 4, 5, 6, 7: Customer Profile & Auth Lifecycle
  describe('Customer Identity & Profile Service', () => {
    it('TEST 3: Formats customer auth errors clearly without exposing internal raw messages', () => {
      const popupClosed = formatCustomerAuthError({ code: 'auth/popup-closed-by-user' });
      expect(popupClosed).toContain('Google sign-in was cancelled');

      const popupBlocked = formatCustomerAuthError({ code: 'auth/popup-blocked' });
      expect(popupBlocked).toContain('popup was blocked');

      const networkErr = formatCustomerAuthError(new Error('A network error occurred'));
      expect(networkErr).toContain('Network connection issue');
    });

    it('TEST 4: provisions a customer profile strictly setting customerId = Firebase Auth UID', async () => {
      const { setDoc, getDoc } = await import('firebase/firestore');
      (getDoc as any).mockResolvedValueOnce({
        exists: () => false
      });

      const mockFirebaseUser = {
        uid: 'cust_google_uid_999',
        displayName: 'Aarav Sharma',
        email: 'aarav.sharma@example.com',
        phoneNumber: '+919876543210',
        photoURL: 'https://lh3.googleusercontent.com/a/photo_123'
      } as any;

      const profile = await provisionCustomerProfile(mockFirebaseUser);

      expect(profile.customerId).toBe('cust_google_uid_999');
      expect(profile.name).toBe('Aarav Sharma');
      expect(profile.email).toBe('aarav.sharma@example.com');
      expect(profile.authProvider).toBe('google.com');
      expect(profile.photoURL).toBe('https://lh3.googleusercontent.com/a/photo_123');

      // Firestore setDoc must have been called with /customers/cust_google_uid_999
      expect(setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'customers/cust_google_uid_999' }),
        expect.objectContaining({
          customerId: 'cust_google_uid_999',
          name: 'Aarav Sharma',
          email: 'aarav.sharma@example.com'
        })
      );
    });

    it('TEST 5: getCustomerProfile accurately reads persisted profile from /customers/{customerId}', async () => {
      const { getDoc } = await import('firebase/firestore');
      (getDoc as any).mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          customerId: 'cust_uid_456',
          name: 'Priya Patel',
          email: 'priya@example.com',
          phone: '9845098450',
          authProvider: 'google.com',
          addresses: [
            {
              id: 'addr_1',
              label: 'home',
              addressLine: 'Flat 402, Sunshine Apts',
              area: 'Indiranagar',
              city: 'Bengaluru',
              postalCode: '560038',
              isDefault: true
            }
          ],
          createdAt: '2026-09-16T00:00:00.000Z',
          updatedAt: '2026-09-16T00:00:00.000Z'
        })
      });

      const profile = await getCustomerProfile('cust_uid_456');
      expect(profile).not.toBeNull();
      expect(profile?.customerId).toBe('cust_uid_456');
      expect(profile?.name).toBe('Priya Patel');
      expect(profile?.phone).toBe('9845098450');
      expect(profile?.addresses?.length).toBe(1);
      expect(profile?.addresses?.[0].city).toBe('Bengaluru');
    });

    it('TEST 6: updateCustomerProfile updates name, phone, addresses without OTP requirement', async () => {
      const { setDoc, getDoc } = await import('firebase/firestore');
      // Mock subsequent getDoc after update
      (getDoc as any).mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          customerId: 'cust_uid_456',
          name: 'Priya Sharma',
          email: 'priya@example.com',
          phone: '9876543210',
          authProvider: 'google.com',
          addresses: [],
          createdAt: '2026-09-16T00:00:00.000Z',
          updatedAt: '2026-09-16T01:00:00.000Z'
        })
      });

      const updated = await updateCustomerProfile('cust_uid_456', {
        name: 'Priya Sharma',
        phone: '9876543210'
      });

      expect(setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'customers/cust_uid_456' }),
        expect.objectContaining({
          name: 'Priya Sharma',
          phone: '9876543210'
        }),
        { merge: true }
      );
      expect(updated.name).toBe('Priya Sharma');
      expect(updated.phone).toBe('9876543210');
    });

    it('TEST 7: logoutCustomer signs out of Firebase Auth', async () => {
      const { signOut } = await import('firebase/auth');
      await logoutCustomer();
      expect(signOut).toHaveBeenCalled();
    });
  });

  // TEST 8: Security Audit for /customers/{customerId}
  describe('TEST 8: Firestore Security Rules Isolation Audit', () => {
    const rulesPath = path.resolve(__dirname, '../../firestore.rules');
    const rulesContent = fs.readFileSync(rulesPath, 'utf8');

    it('enforces strict customer isolation in /customers/{customerId}', () => {
      expect(rulesContent).toMatch(/match\s+\/customers\/\{customerId\}/);
      // Customer profile must be readable and writable ONLY when request.auth.uid == customerId
      expect(rulesContent).toMatch(/allow\s+read,\s*write\s*:\s*if\s+isSignedIn\(\)\s*&&\s*request\.auth\.uid\s*==\s*customerId\s*;/);
    });

    it('does NOT permit public reading or writing of customer profiles', () => {
      const customerBlockMatch = rulesContent.match(/match\s+\/customers\/\{customerId\}[\s\S]*?\}/);
      expect(customerBlockMatch).not.toBeNull();
      const customerBlock = customerBlockMatch![0];
      expect(customerBlock).not.toMatch(/allow\s+read\s*:\s*if\s+true/);
      expect(customerBlock).not.toMatch(/allow\s+write\s*:\s*if\s+true/);
    });

    it('retains restaurant security separation from customer profiles', () => {
      // Restaurant paths must use canAccessRestaurant / isOwnerOfRestaurant, not customer rules
      expect(rulesContent).toMatch(/function\s+canAccessRestaurant\(restaurantId\)/);
      expect(rulesContent).toMatch(/function\s+isOwnerOfRestaurant\(restaurantId\)/);
    });
  });

  // TEST 9, 10, 11: Scope Guard & OTP Absence Check
  describe('Milestone Scope Integrity & OTP Invariant', () => {
    it('verifies that no OTP, SMS or recaptcha dependencies are present in customerAuthService', () => {
      const authServicePath = path.resolve(__dirname, '../services/customerAuthService.ts');
      const authServiceContent = fs.readFileSync(authServicePath, 'utf8');

      expect(authServiceContent).not.toMatch(/RecaptchaVerifier/i);
      expect(authServiceContent).not.toMatch(/signInWithPhoneNumber/i);
      expect(authServiceContent).not.toMatch(/sendOtp/i);
      expect(authServiceContent).not.toMatch(/verifyOtp/i);
      expect(authServiceContent).not.toMatch(/sms/i);
    });

    it('verifies customer profile model phone is an optional plain string field', () => {
      const typesPath = path.resolve(__dirname, '../types/customer.ts');
      const typesContent = fs.readFileSync(typesPath, 'utf8');

      expect(typesContent).toMatch(/interface\s+CustomerProfile/);
      expect(typesContent).toMatch(/phone\?:\s*string;/);
      expect(typesContent).not.toMatch(/phoneVerified/);
      expect(typesContent).not.toMatch(/otp/i);
    });
  });
});
