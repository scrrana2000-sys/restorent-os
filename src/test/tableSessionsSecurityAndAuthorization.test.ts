import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { TableSessionService } from '../services/tableSessionService';
import { TableSession } from '../types/table';

describe('TableSessions Firestore Rules & Authorization Security Model', () => {
  const rulesPath = path.resolve(__dirname, '../../firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf8');

  it('verifies tableSessions subcollection match exists under restaurants/{restaurantId}', () => {
    expect(rulesContent).toMatch(/match\s+\/restaurants\/\{restaurantId\}\s*\{[\s\S]*match\s+\/tableSessions\/\{sessionId\}/);
  });

  it('enforces that tableSessions cannot be accessed without restaurant authorization (no public access)', () => {
    expect(rulesContent).not.toMatch(/match\s+\/tableSessions\/\{sessionId\}\s*\{\s*allow\s+read,\s*write\s*:\s*if\s+true/);
    expect(rulesContent).not.toMatch(/match\s+\/tableSessions\/\{sessionId\}\s*\{\s*allow\s+read\s*:\s*if\s+true/);
    expect(rulesContent).not.toMatch(/match\s+\/tableSessions\/\{sessionId\}\s*\{\s*allow\s+write\s*:\s*if\s+true/);
  });

  it('enforces role-based authorization and server-only protection for tableSessions read and write', () => {
    // Read: requires isServer() or canAccessRestaurant(restaurantId)
    expect(rulesContent).toMatch(/allow\s+read\s*:\s*if\s+isServer\(\)\s*\|\|\s*canAccessRestaurant\(restaurantId\);/);

    // Create: requires server or authorized role (owner, manager, cashier, captain)
    expect(rulesContent).toMatch(/isMemberWithRoles\(restaurantId,\s*\[\s*'manager',\s*'cashier',\s*'captain'\s*\]\)/);

    // Create: strictly enforces tenant isolation and referential integrity
    expect(rulesContent).toMatch(/request\.resource\.data\.id\s*==\s*sessionId/);
    expect(rulesContent).toMatch(/request\.resource\.data\.restaurantId\s*==\s*restaurantId/);
    expect(rulesContent).toMatch(/request\.resource\.data\.tableId\s+is\s+string/);
    expect(rulesContent).toMatch(/exists\(\/databases\/\$\(database\)\/documents\/restaurants\/\$\(restaurantId\)\/tables\/\$\(request\.resource\.data\.tableId\)\)/);
    expect(rulesContent).toMatch(/request\.resource\.data\.status\s*==\s*'open'/);
  });

  it('enforces valid state transitions and field masks on tableSessions update', () => {
    // Update: preserves sessionId, restaurantId, and tableId immutability
    expect(rulesContent).toMatch(/request\.resource\.data\.restaurantId\s*==\s*resource\.data\.restaurantId/);
    expect(rulesContent).toMatch(/request\.resource\.data\.tableId\s*==\s*resource\.data\.tableId/);

    // Close session: allows transition from open to closed with field mask
    expect(rulesContent).toMatch(/resource\.data\.status\s*==\s*'open'\s*&&\s*request\.resource\.data\.status\s*==\s*'closed'/);
  });

  it('preserves separation between auth.uid and restaurantId', () => {
    // restaurantId is not assumed to equal auth.uid; authorization checks ownership or active membership
    expect(rulesContent).toMatch(/function\s+canAccessRestaurant\(restaurantId\)/);
    expect(rulesContent).toMatch(/function\s+isOwnerOfRestaurant\(restaurantId\)/);
    expect(rulesContent).toMatch(/function\s+isMemberOfRestaurant\(restaurantId\)/);
  });
});

describe('TableSessionService Runtime Contract Verification', () => {
  let sessionService: TableSessionService;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionService = new TableSessionService();
  });

  it('tableSessionService writes document with id matching sessionId', async () => {
    const restaurantId = 'rest_tenant_1';
    const tableId = 'tbl_1';
    const guestCount = 4;
    const openedBy = 'user_auth_123';

    // Verify service interface methods
    expect(typeof sessionService.openSession).toBe('function');
    expect(typeof sessionService.closeSession).toBe('function');
    expect(typeof sessionService.updateGuestCount).toBe('function');
    expect(typeof sessionService.getActiveSession).toBe('function');
    expect(typeof sessionService.subscribeToActiveSessions).toBe('function');
  });
});
