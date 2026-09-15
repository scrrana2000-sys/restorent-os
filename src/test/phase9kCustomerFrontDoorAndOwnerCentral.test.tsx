import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  isOwnerCentralRoute,
  buildOwnerCentralUrl,
  isCustomerDiscoveryRoute,
  isCustomerRestaurantRoute,
  extractRestaurantIdentifierFromUrl
} from '../utils/urlUtils';
import { OwnerCentralPage } from '../pages/OwnerCentralPage';
import { PublicCustomerDiscoveryPage } from '../pages/PublicCustomerDiscoveryPage';
import { AuthProvider } from '../context/AuthContext';
import { RestaurantProvider } from '../context/RestaurantContext';

// Mock Firebase Auth and Firestore
vi.mock('../config/firebase', () => ({
  auth: {
    currentUser: null,
    onAuthStateChanged: vi.fn((cb) => {
      cb(null);
      return () => {};
    })
  },
  db: {},
  firebaseConfig: { projectId: 'test-project' }
}));

// Mock AuthContext
vi.mock('../context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../context/AuthContext')>();
  return {
    ...actual,
    useAuth: vi.fn(() => ({
      user: null,
      profile: null,
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      loginGoogle: vi.fn(),
      logout: vi.fn(),
      redirectError: null,
      clearRedirectError: vi.fn()
    }))
  };
});

describe('M9-K: Customer Front Door & Owner Central Architecture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '';
    window.history.pushState({}, '', '/');
  });

  describe('1. URL Routing & Entry Experience', () => {
    it('1.1. identifies /owner, #owner, and ?view=owner as Owner Central routes', () => {
      window.history.pushState({}, '', '/owner');
      expect(isOwnerCentralRoute()).toBe(true);

      window.history.pushState({}, '', '/?view=owner');
      expect(isOwnerCentralRoute()).toBe(true);

      window.location.hash = '#owner';
      expect(isOwnerCentralRoute()).toBe(true);

      window.location.hash = '';
      window.history.pushState({}, '', '/');
      expect(isOwnerCentralRoute()).toBe(false);
    });

    it('1.2. classifies Root "/" as Customer Discovery when not on /owner', () => {
      window.history.pushState({}, '', '/');
      expect(isCustomerDiscoveryRoute()).toBe(true);

      window.history.pushState({}, '', '/owner');
      expect(isCustomerDiscoveryRoute()).toBe(false);
    });

    it('1.3. builds canonical Owner Central URL cleanly', () => {
      const url = buildOwnerCentralUrl();
      expect(url).toContain('#owner');
    });

    it('1.4. preserves legacy M9-J hash route and public code compatibility', () => {
      window.location.hash = '#r/hotel-sagar-raichur-r101/menu';
      expect(isCustomerRestaurantRoute()).toBe(true);
      const ident = extractRestaurantIdentifierFromUrl();
      expect(ident?.slug).toBe('hotel-sagar-raichur-r101');
      expect(ident?.isMenu).toBe(true);
    });
  });

  describe('2. Customer Front Door (Root /)', () => {
    it('2.1. renders PublicCustomerDiscoveryPage with Owner Central entry CTA', () => {
      render(<PublicCustomerDiscoveryPage />);

      expect(screen.getByText('RestaurantOS')).toBeInTheDocument();
      expect(screen.getByText('Online Food Discovery')).toBeInTheDocument();
      const ownerBtns = screen.getAllByRole('button', { name: /owner central/i });
      expect(ownerBtns.length).toBeGreaterThan(0);
    });

    it('2.2. redirects to #owner when clicking Owner Central CTA', () => {
      render(<PublicCustomerDiscoveryPage />);

      const ownerBtn = screen.getAllByRole('button', { name: /owner central/i })[0];
      fireEvent.click(ownerBtn);

      expect(window.location.hash).toBe('#owner');
    });
  });

  describe('3. Owner Central Landing & Authentication', () => {
    it('3.1. renders Owner Central header and login options when unauthenticated', () => {
      render(<OwnerCentralPage />);

      const titleElements = screen.getAllByText(/OWNER CENTRAL/i);
      expect(titleElements.length).toBeGreaterThan(0);
      expect(screen.getByText(/Are you a customer\? Back to RestaurantOS/i)).toBeInTheDocument();
    });

    it('3.2. allows returning to Customer Front Door from unauthenticated Owner Central', () => {
      render(<OwnerCentralPage />);

      const backBtn = screen.getByText(/Are you a customer\? Back to RestaurantOS/i);
      fireEvent.click(backBtn);

      expect(window.location.hash).toBe('#discover');
    });
  });
});
