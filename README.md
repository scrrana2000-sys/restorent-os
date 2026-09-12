# RestaurantOS — Enterprise Restaurant Operating System

RestaurantOS is a full-stack, multi-tenant restaurant point-of-sale (POS), kitchen display (KDS), table management, inventory, and analytics platform built for high-throughput restaurant operations.

---

## Authoritative Documentation & System Architecture
- **Master Project State**: [`PROJECT_STATE.md`](./PROJECT_STATE.md) — Authoritative milestone status, performance benchmarks, and live environment configuration.
- **Project Master Specification**: [`PROJECT_SPEC.md`](./PROJECT_SPEC.md) — Detailed feature specifications, roadmap, and milestone boundaries.
- **Architectural & Business Decisions**: [`PROJECT_DECISIONS.md`](./PROJECT_DECISIONS.md) — Recorded architectural invariants, money math rules, RBAC matrix, and security policies.
- **Changelog**: [`CHANGELOG.md`](./CHANGELOG.md) — Chronological history of releases, optimizations, and bug fixes.
- **Financial Calculation Engine Spec**: [`PROJECT_SPEC_MILESTONE_2.md`](./PROJECT_SPEC_MILESTONE_2.md) — Integer minor unit arithmetic (paise), GST rounding policies, and discount algorithms.

---

## Core System Modules & Features

### 1. POS Terminal & Table Management
- Interactive floor plan with table session lifecycle (Occupied, Free, Session Duration, Guests).
- **Single-Bill Active Table Consolidation**: Appending orders to an active table session automatically merges items into the session's open order instead of fragmenting into multiple bills.
- **Payment Due Center**: Dedicated collection center modal displaying all unpaid/partially paid Takeaway and Dine-In orders with real-time settlement tracking and human-readable table labels (`Table 1`, `Patio VIP`).
- **KOT 2-Minute Grace Period**: POS order cancellation within 2 minutes of KOT dispatch automatically cancels waiting KOTs; after 2 minutes, cancellation must be initiated from KDS to prevent kitchen waste.

### 2. Kitchen Display System (KDS) & Waiter/Captain App
- Real-time KOT tickets queue with live elapsed time alerts, short-name snapshots, and item notes.
- Lifecycle state transitions (`sentToKitchen` → `preparing` → `ready` → `served`).
- Captain floor app for guest count adjustments, order taking, and session status tracking.

### 3. Inventory, Stock Ledger & Recipe Engine
- Multi-location stock management (Kitchen, Bar, Store, Main Warehouse).
- Automatic recipe-based stock deduction on order creation with reversal on cancellation.
- Purchase orders, supplier tracking, stock adjustments, and low-stock threshold alerts.

### 4. Multi-Outlet & Role-Based Access Control (RBAC)
- Multi-tenant isolation under `/restaurants/{restaurantId}/...`.
- User identity (`auth.uid`) is decoupled from restaurant ID (`restaurantId`).
- Granular 6-role RBAC (`owner`, `manager`, `cashier`, `captain`, `kitchen`, `accountant`) enforced at UI, Service, and Firestore Security Rules layers.

### 5. Financial & Audit Integrity
- **Authoritative Minor Integer Units**: All money amounts are calculated and stored in integer paise (`number`) using `roundHalfUp` arithmetic. Zero floating-point drift.
- **Immutable Audit Trail**: Write-once, append-only security logs for all financial and operational mutations.
- **Offline Sync & Idempotency**: Bounded offline mutation queue with deterministic idempotency keys (`clientRequestId`).

---

## Firebase Environment Configuration

- **Current Firebase Project ID**: `project-0edd3716-fc3b-40b7-b96` *(Authoritative)*
- **Named Firestore Database**: `ai-studio-restaurantos-16bfb108-09a4-44fb-9463-1d58d938bd57`
- **Storage Bucket**: `project-0edd3716-fc3b-40b7-b96.firebasestorage.app`
- **Auth Domain**: `project-0edd3716-fc3b-40b7-b96.firebaseapp.com`

---

## Verification & Execution Commands

### Development Server
```bash
npm run dev
```

### Type Checking & Linting
```bash
npx tsc --noEmit
npm run lint
```

### Test Suite Execution
```bash
npx vitest run
```

### Production Build
```bash
npm run build
```
