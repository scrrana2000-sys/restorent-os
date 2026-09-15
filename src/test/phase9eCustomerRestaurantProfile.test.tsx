import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CustomerRestaurantPage } from '../pages/customer/CustomerRestaurantPage';
import {
  resolveRestaurantBySlug,
  resolveRestaurantByPublicCode,
  resolveRestaurantById
} from '../services/customerDiscoveryService';
import {
  buildPublicRestaurantUrl,
  extractRestaurantIdentifierFromUrl,
  isCustomerRestaurantRoute
} from '../utils/urlUtils';
import { PublicRestaurantProfile } from '../types/customer';

// Mock firebase firestore methods used by customerDiscoveryService
vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore');
  return {
    ...actual,
    collection: vi.fn(),
    doc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn()
  };
});

import { getDocs, getDoc } from 'firebase/firestore';

const mockPublicRestaurant1: PublicRestaurantProfile = {
  restaurantId: 'rest-raichur-01',
  publicSlug: 'sharma-sweets-raichur',
  publicRestaurantCode: 'R-RC01',
  name: 'Sharma Sweets & Restaurant',
  legalName: 'Sharma Foods Private Limited',
  logoUrl: 'https://images.unsplash.com/logo-sharma.jpg',
  coverImageUrl: 'https://images.unsplash.com/cover-sharma.jpg',
  phone: '+91 98765 43210',
  address: 'Station Road, Near Bus Stand',
  city: 'Raichur',
  state: 'Karnataka',
  area: 'Station Area',
  postalCode: '584101',
  country: 'India',
  currency: 'INR',
  currencySymbol: '₹',
  cuisine: ['North Indian', 'Sweets', 'Chaat'],
  publicStatus: 'active',
  onlineOrderingEnabled: true,
  takeawayEnabled: true,
  deliveryEnabled: true,
  isOpenNow: true
};

const mockPublicRestaurantPaused: PublicRestaurantProfile = {
  restaurantId: 'rest-raichur-02',
  publicSlug: 'royal-biryani-raichur',
  publicRestaurantCode: 'R-RC02',
  name: 'Royal Biryani House',
  logoUrl: null,
  coverImageUrl: null,
  phone: '+91 91234 56789',
  address: 'Main Bazaar Road',
  city: 'Raichur',
  state: 'Karnataka',
  area: 'Market Circle',
  postalCode: '584101',
  country: 'India',
  currency: 'INR',
  currencySymbol: '₹',
  cuisine: ['Biryani', 'Mughlai'],
  publicStatus: 'paused',
  onlineOrderingEnabled: true,
  takeawayEnabled: true,
  deliveryEnabled: false,
  isOpenNow: false
};

const mockPublicRestaurantClosed: PublicRestaurantProfile = {
  restaurantId: 'rest-raichur-03',
  publicSlug: 'midnight-bites-raichur',
  publicRestaurantCode: 'R-RC03',
  name: 'Midnight Bites Cafe',
  logoUrl: null,
  coverImageUrl: null,
  phone: '',
  address: '',
  city: 'Raichur',
  state: 'Karnataka',
  area: 'College Road',
  postalCode: '',
  country: 'India',
  currency: 'INR',
  currencySymbol: '₹',
  cuisine: ['Fast Food', 'Beverages'],
  publicStatus: 'closed',
  onlineOrderingEnabled: false,
  takeawayEnabled: false,
  deliveryEnabled: false,
  isOpenNow: false
};

describe('M9-E Customer Restaurant Public Profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------
  // SECTION 1: Resolution by Slug & Public Code
  // -------------------------------------------------------------
  describe('Service Resolution (resolveRestaurantBySlug & resolveRestaurantByPublicCode)', () => {
    it('(1) resolves valid public slug and returns public profile', async () => {
      (getDocs as any).mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'rest-raichur-01',
            data: () => ({ ...mockPublicRestaurant1 })
          }
        ]
      });

      const profile = await resolveRestaurantBySlug('sharma-sweets-raichur');
      expect(profile).not.toBeNull();
      expect(profile?.name).toBe('Sharma Sweets & Restaurant');
      expect(profile?.publicSlug).toBe('sharma-sweets-raichur');
      expect(profile?.publicRestaurantCode).toBe('R-RC01');
      expect(profile?.isOpenNow).toBe(true);
    });

    it('(2) resolves normalized slug with casing / spacing variations', async () => {
      (getDocs as any).mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'rest-raichur-01',
            data: () => ({ ...mockPublicRestaurant1 })
          }
        ]
      });

      const profile = await resolveRestaurantBySlug('  Sharma-Sweets-Raichur  ');
      expect(profile).not.toBeNull();
      expect(profile?.publicSlug).toBe('sharma-sweets-raichur');
    });

    it('(3) returns null for non-existent slug', async () => {
      (getDocs as any).mockResolvedValueOnce({
        empty: true,
        docs: []
      });

      const profile = await resolveRestaurantBySlug('unknown-restaurant');
      expect(profile).toBeNull();
    });

    it('(4) returns null for empty or invalid slug input', async () => {
      const profile = await resolveRestaurantBySlug('');
      expect(profile).toBeNull();
    });

    it('(5) resolves valid public code (e.g. R-RC01)', async () => {
      (getDocs as any).mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'rest-raichur-01',
            data: () => ({ ...mockPublicRestaurant1 })
          }
        ]
      });

      const profile = await resolveRestaurantByPublicCode('R-RC01');
      expect(profile).not.toBeNull();
      expect(profile?.publicRestaurantCode).toBe('R-RC01');
    });

    it('(6) resolves lowercase or untrimmed public code', async () => {
      (getDocs as any).mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'rest-raichur-01',
            data: () => ({ ...mockPublicRestaurant1 })
          }
        ]
      });

      const profile = await resolveRestaurantByPublicCode('  r-rc01  ');
      expect(profile).not.toBeNull();
      expect(profile?.publicRestaurantCode).toBe('R-RC01');
    });

    it('(7) returns null for invalid or non-existent code', async () => {
      (getDocs as any).mockResolvedValueOnce({
        empty: true,
        docs: []
      });

      const profile = await resolveRestaurantByPublicCode('R-NONEXISTENT');
      expect(profile).toBeNull();
    });

    it('(7b) resolves restaurant directly by ID if provided', async () => {
      (getDoc as any).mockResolvedValueOnce({
        exists: () => true,
        id: 'rest-raichur-01',
        data: () => ({ ...mockPublicRestaurant1 })
      });

      const profile = await resolveRestaurantById('rest-raichur-01');
      expect(profile).not.toBeNull();
      expect(profile?.restaurantId).toBe('rest-raichur-01');
    });
  });

  // -------------------------------------------------------------
  // SECTION 2: UI Presentation & Data Isolation
  // -------------------------------------------------------------
  describe('CustomerRestaurantPage UI & Presentation', () => {
    it('(8) renders restaurant name, public code, address, city, area, state accurately', () => {
      render(<CustomerRestaurantPage initialProfile={mockPublicRestaurant1} />);

      expect(screen.getByText('Sharma Sweets & Restaurant')).toBeInTheDocument();
      expect(screen.getAllByText('R-RC01').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Station Road, Near Bus Stand')).toBeInTheDocument();
      expect(screen.getByText(/Station Area, Raichur, Karnataka/i)).toBeInTheDocument();
    });

    it('(9) renders cuisine tags cleanly', () => {
      render(<CustomerRestaurantPage initialProfile={mockPublicRestaurant1} />);

      expect(screen.getByText('North Indian')).toBeInTheDocument();
      expect(screen.getByText('Sweets')).toBeInTheDocument();
      expect(screen.getByText('Chaat')).toBeInTheDocument();
    });

    it('(10) renders cover image and logo when present', () => {
      render(<CustomerRestaurantPage initialProfile={mockPublicRestaurant1} />);

      const coverImg = screen.getByAltText('Sharma Sweets & Restaurant');
      expect(coverImg).toHaveAttribute('src', 'https://images.unsplash.com/cover-sharma.jpg');

      const logoImg = screen.getByAltText('Sharma Sweets & Restaurant logo');
      expect(logoImg).toHaveAttribute('src', 'https://images.unsplash.com/logo-sharma.jpg');
    });

    it('(11) renders fallback placeholders when cover image or logo are missing', () => {
      const withoutImages: PublicRestaurantProfile = {
        ...mockPublicRestaurant1,
        coverImageUrl: null,
        logoUrl: null
      };

      render(<CustomerRestaurantPage initialProfile={withoutImages} />);
      expect(screen.queryByAltText('Sharma Sweets & Restaurant')).toBeNull();
      expect(screen.getByText('Sharma Sweets & Restaurant')).toBeInTheDocument();
    });

    it('(12) renders phone contact and tel link when phone is present', () => {
      render(<CustomerRestaurantPage initialProfile={mockPublicRestaurant1} />);

      const phoneLink = screen.getByText('+91 98765 43210');
      expect(phoneLink).toBeInTheDocument();
      expect(phoneLink.closest('a')).toHaveAttribute('href', 'tel:+91 98765 43210');
    });

    it('(13) renders open status badge ("Open for Orders") when active and online ordering enabled', () => {
      render(<CustomerRestaurantPage initialProfile={mockPublicRestaurant1} />);

      expect(screen.getByText(/Open for Orders/i)).toBeInTheDocument();
    });

    it('(14) renders paused notice and badge when publicStatus is paused', () => {
      render(<CustomerRestaurantPage initialProfile={mockPublicRestaurantPaused} />);

      expect(screen.getByText('Currently Paused')).toBeInTheDocument();
      expect(screen.getByText('Restaurant Temporarily Paused')).toBeInTheDocument();
      expect(screen.getByText(/short pause and not accepting new incoming orders/i)).toBeInTheDocument();
    });

    it('(15) renders closed notice and badge when publicStatus is closed', () => {
      render(<CustomerRestaurantPage initialProfile={mockPublicRestaurantClosed} />);

      expect(screen.getByText('Currently Closed')).toBeInTheDocument();
      expect(screen.getByText('Restaurant Currently Closed')).toBeInTheDocument();
    });

    it('(16) renders online ordering unavailable notice when onlineOrderingEnabled is false', () => {
      const dineInOnly: PublicRestaurantProfile = {
        ...mockPublicRestaurant1,
        onlineOrderingEnabled: false,
        isOpenNow: false
      };

      render(<CustomerRestaurantPage initialProfile={dineInOnly} />);
      expect(screen.getByText('Dine-in / Walk-in Only')).toBeInTheDocument();
      expect(screen.getByText('Online Ordering Unavailable')).toBeInTheDocument();
    });

    it('(17) displays delivery capability accurately (Available vs Unavailable)', () => {
      const { rerender } = render(<CustomerRestaurantPage initialProfile={mockPublicRestaurant1} />);
      const deliveryEl = screen.getByTestId ? null : screen.getByText('Home Delivery').closest('div');
      expect(screen.getByText('Direct doorstep food delivery')).toBeInTheDocument();

      rerender(<CustomerRestaurantPage initialProfile={mockPublicRestaurantPaused} />);
      expect(screen.getByText('Not currently offering delivery')).toBeInTheDocument();
    });

    it('(18) displays takeaway capability accurately (Available vs Unavailable)', () => {
      const { rerender } = render(<CustomerRestaurantPage initialProfile={mockPublicRestaurant1} />);
      expect(screen.getByText('Pick up order directly at restaurant')).toBeInTheDocument();

      rerender(<CustomerRestaurantPage initialProfile={mockPublicRestaurantClosed} />);
      expect(screen.getByText('Takeaway pickup not available')).toBeInTheDocument();
    });

    it('(19) strictly never leaks private tenant fields (no ownerUid, GST, FSSAI, staff, inventory)', () => {
      // Mock dangerous object passing in case someone passed full restaurant
      const sanitizedDoc: any = {
        ...mockPublicRestaurant1,
        ownerId: 'SECRET_OWNER_UID_123',
        gstNumber: '29ABCDE1234F1Z5',
        fssaiLicense: '11223344556677',
        dailyRevenue: 50000,
        staffList: ['user_1', 'user_2']
      };

      render(<CustomerRestaurantPage initialProfile={sanitizedDoc} />);

      expect(screen.queryByText('SECRET_OWNER_UID_123')).toBeNull();
      expect(screen.queryByText('29ABCDE1234F1Z5')).toBeNull();
      expect(screen.queryByText('11223344556677')).toBeNull();
      expect(screen.queryByText('50000')).toBeNull();
    });
  });

  // -------------------------------------------------------------
  // SECTION 3: Dynamic State Handling & Interactivity
  // -------------------------------------------------------------
  describe('Page States (Loading, Not Found, Error, Navigation)', () => {
    it('(20) shows loading skeleton while profile is being fetched', () => {
      (getDocs as any).mockImplementation(() => new Promise(() => {})); // Never resolves

      render(<CustomerRestaurantPage slug="sharma-sweets-raichur" />);
      expect(document.getElementById('profile-loading-skeleton')).toBeInTheDocument();
    });

    it('(21) shows not found state when slug or code does not resolve to any restaurant', async () => {
      (getDocs as any).mockResolvedValueOnce({
        empty: true,
        docs: []
      });

      render(<CustomerRestaurantPage slug="missing-restaurant" />);

      await waitFor(() => {
        expect(screen.getByText(/Restaurant Not Found/i)).toBeInTheDocument();
      });
      expect(screen.getByText(/The restaurant you requested is not listed/i)).toBeInTheDocument();
    });

    it('(22) shows error state with Retry button when fetch throws an error, and retrying triggers resolution again', async () => {
      (getDocs as any).mockRejectedValueOnce(new Error('Network offline'));

      render(<CustomerRestaurantPage slug="sharma-sweets-raichur" />);

      await waitFor(() => {
        expect(screen.getByText(/Could Not Load Profile/i)).toBeInTheDocument();
      });
      expect(screen.getByText(/Unable to load restaurant details/i)).toBeInTheDocument();

      // Retry
      (getDocs as any).mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'rest-raichur-01',
            data: () => ({ ...mockPublicRestaurant1 })
          }
        ]
      });

      fireEvent.click(screen.getByText('Retry'));

      await waitFor(() => {
        expect(screen.getByText('Sharma Sweets & Restaurant')).toBeInTheDocument();
      });
    });

    it('(23) handles back to discovery button click (calls onBackToDiscovery)', () => {
      const handleBack = vi.fn();
      render(<CustomerRestaurantPage initialProfile={mockPublicRestaurant1} onBackToDiscovery={handleBack} />);

      fireEvent.click(screen.getByText('Back to Discovery'));
      expect(handleBack).toHaveBeenCalledTimes(1);
    });

    it('(24) handles "View Menu" button click (boundary to M9-F)', () => {
      const handleViewMenu = vi.fn();
      render(<CustomerRestaurantPage initialProfile={mockPublicRestaurant1} onViewMenu={handleViewMenu} />);

      fireEvent.click(screen.getByText('View Menu'));
      expect(handleViewMenu).toHaveBeenCalledWith(mockPublicRestaurant1);
    });

    it('(24b) shows M9-F preview notice modal if onViewMenu prop is not provided', () => {
      render(<CustomerRestaurantPage initialProfile={mockPublicRestaurant1} />);

      fireEvent.click(screen.getByText('View Menu'));
      expect(screen.getByText(/Public menu browsing and customer food ordering will be activated in the upcoming Milestone/i)).toBeInTheDocument();

      fireEvent.click(screen.getByText('Close Preview'));
      expect(screen.queryByText(/Public menu browsing and customer food ordering will be activated in the upcoming Milestone/i)).toBeNull();
    });
  });

  // -------------------------------------------------------------
  // SECTION 4: URL & Routing Utilities
  // -------------------------------------------------------------
  describe('Routing & URL Resolution', () => {
    it('(25) extractRestaurantIdentifierFromUrl extracts slug from path /r/sharma-sweets-raichur', () => {
      delete (window as any).location;
      window.location = {
        pathname: '/r/sharma-sweets-raichur',
        search: '',
        hash: '',
        origin: 'http://localhost:3000'
      } as any;

      const result = extractRestaurantIdentifierFromUrl();
      expect(result).toEqual({ slug: 'sharma-sweets-raichur', isMenu: false });
      expect(isCustomerRestaurantRoute()).toBe(true);
    });

    it('(26) extractRestaurantIdentifierFromUrl extracts slug and isMenu from hash #r/sharma-sweets-raichur/menu', () => {
      delete (window as any).location;
      window.location = {
        pathname: '/',
        search: '',
        hash: '#r/sharma-sweets-raichur/menu',
        origin: 'http://localhost:3000'
      } as any;

      const result = extractRestaurantIdentifierFromUrl();
      expect(result).toEqual({ slug: 'sharma-sweets-raichur', isMenu: true });
      expect(isCustomerRestaurantRoute()).toBe(true);
    });

    it('(27) extractRestaurantIdentifierFromUrl extracts code from query ?code=R-RC01 or ?r=sharma-sweets', () => {
      delete (window as any).location;
      window.location = {
        pathname: '/',
        search: '?code=R-RC01',
        hash: '',
        origin: 'http://localhost:3000'
      } as any;

      const result1 = extractRestaurantIdentifierFromUrl();
      expect(result1).toEqual({ code: 'R-RC01', isMenu: false });

      window.location.search = '?r=sharma-sweets&menu=true';
      const result2 = extractRestaurantIdentifierFromUrl();
      expect(result2).toEqual({ slug: 'sharma-sweets', isMenu: true });
    });

    it('(28) buildPublicRestaurantUrl generates canonical public URLs preserving slug and menu flags', () => {
      const url1 = buildPublicRestaurantUrl('sharma-sweets-raichur');
      expect(url1).toContain('#r/sharma-sweets-raichur');

      const url2 = buildPublicRestaurantUrl('sharma-sweets-raichur', true);
      expect(url2).toContain('#r/sharma-sweets-raichur/menu');
    });
  });
});
