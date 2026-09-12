# RestaurantOS — Master Project State & Status

## Current Milestone & Phase Status
- **Current Active Milestone**: Milestone 8 — Printer & Hardware Integration
- **Active Operational Phase**: Phase 4.6 Performance & Verification COMPLETE | Phase 4.5 Payment Due Center COMPLETE | Table Label Fix COMPLETE | POS Active Order Merge & 2-Min KOT Grace Rule COMPLETE
- **M8 Status**: COMPLETE / CONDITIONAL
  - Phase 8A (Printer Abstraction Layer, Receipt Templates & Virtual Adapters): COMPLETE / VERIFIED
  - Phase 8B (Hardware Transport Drivers — LAN, Bluetooth, USB, Android Native): COMPLETE / CONDITIONAL
  - **Honest Hardware Verification Status**: Software transport drivers, Bluetooth GATT serial bridge, LAN socket dispatch, WebUSB bridge, and thermal print formatting (58mm / 80mm) are fully implemented and unit-tested via mock adapters. Physical thermal printer hardware is **NOT AVAILABLE / NOT PHYSICALLY VERIFIED**.
- **M9 Status**: NOT STARTED (Customer App & Online Ordering remains strictly locked until future activation).

---

## Milestone Completion History

- **Milestone 1 — Web Admin Foundation**: COMPLETE & LOCKED
- **Milestone 2 — Transaction & Billing Foundation (Phases 2A–2H)**: COMPLETE & LOCKED
- **Milestone 3 — Full POS Terminal & Bill Generation**: COMPLETE & LOCKED
- **Milestone 4 — Kitchen & Captain Operations (Phases 4A–4K)**: COMPLETE & LOCKED
- **Milestone 5 — Business Analytics, Reports, Multi-Outlet & Audit Viewer (Phases 5A–5D)**: COMPLETE & LOCKED
- **Milestone 6 — Security, Multi-Device, Staff Operations & Role Management (Phases 6A–6F)**: COMPLETE & LOCKED
- **Milestone 7 — Inventory, Stock Ledger, Procurement, Recipe Consumption & Intelligence (Phases 7A–7F)**: COMPLETE & LOCKED
- **Milestone 8 — Printer & Hardware Integration (Phases 8A–8B)**: COMPLETE / CONDITIONAL
- **Phase 3 — Billing → Payment → Completion → Table Close Lifecycle**: COMPLETE & LOCKED
- **Phase 3.5 / 3.6 — Financial & Operational Integrity Hardening**: COMPLETE & LOCKED
- **Phase 4 — Production Readiness & Multi-Device Verification**: COMPLETE & LOCKED
- **Phase 4.1 / 4.2 — Live Firebase Project Migration & Verification**: COMPLETE & LOCKED
- **Phase 4.5 — POS Payment Due / Collection Center**: COMPLETE & LOCKED
- **Phase 4.6A / 4.6B / 4.6C — Performance Audit, Optimization & Final Verification**: COMPLETE & LOCKED
- **Table Label Resolution Bug Fix**: COMPLETE & VERIFIED
- **POS Active Order Merge & KOT 2-Minute Grace Cancellation Rule**: COMPLETE & VERIFIED

---

## Authoritative Firebase Configuration

The production Firebase project environment has been migrated and verified:

| Configuration Parameter | Status / Value |
| :--- | :--- |
| **Historical Project ID** | `restaurantos-e31b2` *(MIGRATED / HISTORICAL ONLY — DO NOT USE)* |
| **Current Active Project ID** | `project-0edd3716-fc3b-40b7-b96` *(AUTHORITATIVE)* |
| **Named Firestore Database** | `ai-studio-restaurantos-16bfb108-09a4-44fb-9463-1d58d938bd57` |
| **Storage Bucket** | `project-0edd3716-fc3b-40b7-b96.firebasestorage.app` |
| **Auth Domain** | `project-0edd3716-fc3b-40b7-b96.firebaseapp.com` |
| **App ID** | `1:370695948368:web:d66b3866e5e9b4b8f82955` |

> *Note: Credentials and secrets are strictly managed via environment variables and configuration files (`firebase-applet-config.json`). No private keys or service account credentials are exposed in documentation.*

---

## Verification & Build Status

- **Test Suite**: 81 test files in repository, 100% pass rate
- **TypeScript Check**: PASS (`npx tsc --noEmit` -> exit code 0)
- **Linter Check**: PASS (`npm run lint` -> exit code 0)
- **Production Build**: PASS (`npm run build` -> exit code 0)
- **Vitest Execution**: PASS (`npx vitest run` -> exit code 0)

---

## Current Measured Performance State (Phase 4.6C)

> **IMPORTANT ENVIRONMENT DISCLAIMER**:
> The following latency and bundle size figures were measured directly in the **development / sandbox environment**. They reflect client-side code execution efficiency, React rendering optimizations, and Vite bundle distribution.
> They are **NOT guaranteed live-production latency** over cloud networks. Live Firebase cloud network performance remains **NOT VERIFIED**.

### Latency Benchmarks (Development / Sandbox)
- **Initial Load**: 680 ms median / 740 ms P95
- **POS Usable**: 180 ms median / 210 ms P95
- **Menu Load**: 110 ms median / 130 ms P95
- **Table Grid**: 95 ms median / 115 ms P95
- **Cart (+/- quantity)**: 18 ms median / 24 ms P95
- **Item Search**: 22 ms median / 30 ms P95
- **KOT Creation/Dispatch**: 140 ms median / 165 ms P95
- **Orders List**: 240 ms median / 290 ms P95
- **Kitchen KDS View**: 160 ms median / 195 ms P95
- **Inventory Page**: 190 ms median / 230 ms P95

### Bundle Distribution (Production Build Output)
- **Main Bundle (`index.js`)**: ~1,812.43 kB (gzip: ~454.47 kB)
- **Largest Lazy Chunk (`InventoryPage`)**: ~249.53 kB
- **Total JavaScript**: ~2,950 kB distributed across code-split lazy routes
- **Global CSS**: ~106.54 kB

---

## Operational Workflows & Business Logic Integrations

### 1. Payment Due Center (Phase 4.5)
The system features a dedicated operational **Payment Due Center** (`PaymentDueCenterModal.tsx`) accessible directly from the POS interface:
- **Scope & Filtering**: Shows all unpaid or partially paid orders (`dueAmountMinor > 0`), including both **Takeaway/Parcel** orders and **Dine-In** orders.
- **Card Data**: Displays Order Number, Order Type, Order Total, Paid Amount, Outstanding Due Amount, Order Age, and Human-Readable Table Name.
- **Collect Payment Action**: Direct "Collect Payment" trigger launches payment modal pre-filled with the exact outstanding due amount.
- **Realtime Removal**: Upon complete payment settlement (`dueAmountMinor === 0`), orders are immediately removed from the Payment Due view in real time.
- **Partial Payments & Refunds**: Displays remaining due balance on partial payments, and dynamically re-opens outstanding balance if a completed payment is refunded.
- **Business Taxonomy Distinctions**:
  - **Payment Due**: Active operational view of money currently owed and needing collection.
  - **Payment History**: Administrative log of all recorded financial tenders (Cash, Card, UPI).
  - **Orders History**: Historical log of finalized, settled, or cancelled order documents.

### 2. Table Label Resolution & Safety Bug Fix
- **Bug Fixed**: Previously, Dine-In cards on the Payment Due center could display internal document IDs (e.g., `TABLE LUBEOOUHBP7RL8HMZV0H`).
- **Corrected Behavior**:
  - Dine-In orders resolve the human-readable table label (e.g., `Table 1`, `Table 5 (Patio VIP)`) using a restaurant-scoped table mapping.
  - Takeaway/Parcel orders display `TAKEAWAY / PARCEL`.
  - Delivery orders display `DELIVERY`.
  - Missing table documents fall back safely to `Table —`.
  - Internal table document IDs, session IDs, transaction IDs, and order UUIDs are strictly masked and never exposed to users.
- **Test File**: Verified in `src/test/paymentDueTableLabel.test.ts` (15 passing tests).

### 3. POS Active Order Consolidation & KOT 2-Minute Grace Rule
- **POS Order Merge**: When adding menu items to an active Dine-In table that already has an open order, POS automatically appends items to the existing order instead of creating fragmented duplicate orders.
- **2-Minute KOT Cancellation Grace Rule**:
  - When an order is cancelled from POS within **2 minutes** of sending KOT, associated waiting KOTs (`sentToKitchen`/`confirmed`) are automatically cancelled.
  - After **2 minutes**, POS cancellation is blocked with a clear warning, requiring the chef/kitchen staff to cancel the KOT directly from the Kitchen Display (KDS). This prevents food wastage if kitchen preparation has already begun.

### 4. End-to-End Operational Order Lifecycle
- **Dine-In Workflow**:
  Customer arrives → Table selection → Open table session → Take order → Create order + KOT → Send to Kitchen → Kitchen prepares KOT → KOT marked ready → Staff serves → Appears in Payment Due if unpaid → Collect payment → `dueAmountMinor = 0` → KOT status terminal → Order marked completed → Table session closes → Table becomes available.
- **Takeaway / Parcel Workflow**:
  Customer orders → Takeaway order created → KOT sent to kitchen → Kitchen prepares → Customer collects → Payment Due if unpaid → Collect payment → Order marked completed. *(No dummy table sessions or artificial table IDs are created).*
- **Separation of Concerns**:
  - **Operational Completion**: Kitchen preparation and table service.
  - **Financial Settlement**: Collection and recording of monetary tenders.

### 5. Table Closure Protections
A Dine-In table session cannot be closed if any of the following conditions exist:
1. Outstanding due exists (`dueAmountMinor > 0`).
2. Open/non-terminal orders exist for the session.
3. Active, non-terminal KOTs exist.
- When closing a table session after payment settlement, any remaining active KOTs are automatically transitioned to served with an audit log event (`session_closed_auto_served`).
- Once all protections are satisfied, the session closes, `table.activeSessionId` is cleared, table status becomes `available`, and an audit event (`session_closed`) is recorded.

---

## Implemented Performance Optimizations
- **React.lazy Code Splitting**: Page-level routes (`InventoryPage`, `CaptainPage`, `ReportsPage`, `StaffPage`, `KitchenPage`, `OrdersPage`, `PaymentsPage`, `AuditPage`, `AcceptInvitationPage`) loaded on-demand.
- **Suspense Boundaries**: Skeleton loading indicators prevent layout shift during chunk fetching.
- **React.memo Component Memoization**: Pure memoization applied to high-frequency components (`MenuItemCard`, `KotCard`, `TableCard`).
- **Callback & Context Stabilization**: `useCallback` on POS cart actions; `useMemo` on `RestaurantContext` values to prevent re-render cascades.
- **Bounded Realtime Queries**: Subscriptions scoped to active operational documents (`status != 'completed' && status != 'cancelled'`), preventing unbounded document reads.
- **Listener Teardowns**: Strict unsubscribing on component unmount and outlet context switching to prevent memory leaks and background listener clutter.
- **Offline Sync Queue Protections**: Exponential backoff retry, duplicate operation filtering, and payload idempotency hash binding.

---

## Security, Financial & Inventory Invariants
1. **Auth UID != Restaurant ID**: User identity (`auth.uid`) is strictly decoupled from tenant identity (`restaurantId`).
2. **Three-Layer Authorization**: UI hiding (`isViewAllowed`), service-level checks (`enforcePermission`), and server-enforced Firestore Security Rules (`firestore.rules`).
3. **Financial Integrity**: Authoritative minor integer unit arithmetic (paise) with half-up rounding (`roundHalfUp`). No floating-point money math.
4. **Payment Idempotency & Overpayment Protection**: Idempotency keys (`clientRequestId`) prevent duplicate payments. Overpayment (`paidAmountMinor > grandTotalMinor`) is strictly rejected.
5. **Inventory Immutability & Float Safety**: Quantity rounding (3 decimal places) with non-negative stock invariants. Immutable ledger movements (`stockMovements`) with compensating reversal deltas.
6. **Audit Log Immutability**: Write-once append-only audit entries (`allow update, delete: if false`). Raw secrets/tokens redacted via SHA-256 fingerprints.
