> **Release-candidate update — September 18, 2026:** The source has undergone additional production hardening after the historical status below. Current release gates include server-authoritative order/KOT creation, tokenized guest access, webhook retry-safe idempotency, server-only stock locks, stricter POS API validation, and CI-enforced security/typecheck/test/build verification. Fresh dependency-backed verification could not be executed in the sandbox because npm dependency installation timed out; use the CI gate before deployment.

# RestaurantOS — Master Project Status & Governance

## 1. Master System Status
- **System Version**: RestaurantOS v1.1.0
- **Operational Readiness**: PRODUCTION READY
- **Multi-Tenant Status**: Fully Isolated (Strict `restaurantId` scoping across all collections, storage, and rules)
- **Database & Backend**: Firebase Firestore with Node/Express full-stack proxy & verification endpoints
- **Current Milestone Feature**: Subscription System + 7-Day Free Trial + Commercial Pricing & Customization (Integrated into Owner Center)

---

## 2. Milestone Architecture & Lifecycle

| Milestone | Title | Status | Verification |
| :--- | :--- | :--- | :--- |
| **M1** | Web Admin Foundation | **COMPLETE & LOCKED** | Verified |
| **M2** | Transaction & Billing Foundation (Phases 2A–2H) | **COMPLETE & LOCKED** | Verified |
| **M3** | Full POS Terminal & Bill Generation | **COMPLETE & LOCKED** | Verified |
| **M4** | Kitchen & Captain Operations (Phases 4A–4K) | **COMPLETE & LOCKED** | Verified |
| **M5** | Business Analytics, Reports, Multi-Outlet & Audit Viewer | **COMPLETE & LOCKED** | Verified |
| **M6** | Security, Multi-Device, Staff Operations & Role Management | **COMPLETE & LOCKED** | Verified |
| **M7** | Inventory, Stock Ledger, Procurement, Recipe Consumption | **COMPLETE & LOCKED** | Verified |
| **M8.5**| Adaptive Operational Models (Single Person, Cafe, Full Service) | **COMPLETE & LOCKED** | Verified |
| **M9** | Multi-Tenant Online Ordering & Customer CRM (Phases 9A–9K) | **COMPLETE & LOCKED** | Verified |
| **M10**| AI Item Recognition | **ON HOLD / DEFERRED** | Deferred (Manual item workflow sufficient) |
| **M11**| Voice Assistant & Hands-Free POS | **COMPLETE & LOCKED** | Verified |
| **M12**| Production Hardening, PWA, SEO & Launch Readiness | **COMPLETE & LOCKED** | Verified |
| **SUB**| Subscription System, Commercial Plans & Customization | **COMPLETE & PRODUCTION-HARDENED** | Verified |
| **RZP**| Razorpay Subscription Gateway & Webhook Engine | **PRODUCTION-HARDENED & PRE-CREDENTIAL VERIFIED** | Verified (Credentials deferred per user direction) |
| **DEP**| Cloud Run Production Deployment & Webhook Ingress | **READY FOR CLOUD RUN DEPLOYMENT** | Awaiting User-Triggered Cloud Run Deploy in AI Studio |

---

## 3. Subscription System & Commercial Plan Specification

### A. Architectural Principles & Invariants
1. **Restaurant-Bound State**:
   - The 7-day trial and active subscriptions are stored directly under the tenant's path: `/restaurants/{restaurantId}/subscription/current`.
   - Never stored in `localStorage`, cookies, or browser-only caches.
   - Survives browser refreshes, device changes, session expiration, and staff logouts without resetting.
2. **Server-Authoritative Enforcement**:
   - Payments and plan transitions are cryptographically validated by the backend (`/api/subscription/verify-and-activate`).
   - Server-side Razorpay signature verification via HMAC SHA-256 (`verifyRazorpayPaymentSignature` & `verifyRazorpayWebhookSignature`).
   - Firestore security rules protect subscription records:
     - `subscription`: Read by tenant staff; write restricted to tenant owners and server processes.
     - `subscriptionHistory`: Immutable ledger; only creation allowed, updates/deletions strictly denied.
     - `subscriptionWebhookEvents`: Server-only isolation (`allow read, write: if isServer()`).
3. **Persistent Webhook Idempotency Engine**:
   - Firestore-backed persistent idempotency collection (`/subscriptionWebhookEvents/{eventId}`).
   - Atomic Optimistic Concurrency Control (OCC) via `runTransaction` prevents double-activation and race conditions during simultaneous webhook delivery.
   - Survives server restarts, multi-instance container deployments, and scale-out resets.
   - Multi-layer payment deduplication prevents duplicate activation and duplicate audit events across sequential webhooks, concurrent deliveries, and frontend verify-and-activate interactions.
4. **Pluggable Payment Gateway Abstraction**:
   - Defined via `SubscriptionPaymentProvider` interface.
   - Clean separation of client and server secrets: frontend NEVER receives or exposes `RAZORPAY_KEY_SECRET` or `RAZORPAY_WEBHOOK_SECRET`.
   - Client-side checkout uses only the public Key ID (`RAZORPAY_KEY_ID`).
   - All monetary amounts computed strictly server-side from authoritative commercial plan configs (`COMMERCIAL_PLANS`).
5. **RBAC & Separation of Concerns**:
   - `access_subscription`: Granted to Owners and Managers (enabling review of current tier, expiration date, and billing history).
   - `manage_subscription`: Granted exclusively to Owners (authorizing checkout, plan upgrades, and billing changes).
   - Non-managerial staff (Cashier, Kitchen, Captain, Accountant) are completely blocked from subscription management.
6. **Operational State Gating**:
   - While on an active trial or paid plan, full restaurant operations (POS, KOT, Inventory, Billing) remain unlocked.
   - If a trial or subscription expires, operational creation is locked while read-only historical audits, reports, and settings remain accessible.

---

## 4. Final Commercial Plan Catalog & Customization

| Plan Tier | Monthly Price | Type | Features & Operational Limits |
| :--- | :--- | :--- | :--- |
| **7-Day Free Trial** | Free (₹0) | Trial Window | Complete access to all RestaurantOS features for 7 continuous days. |
| **Starter** | **₹299 / month** | Commercial Paid | Single-station POS, 15 tables, 5 staff accounts, KOT generation, digital QR menu, daily reports, receipt printing. |
| **Growth** | **₹699 / month** | Commercial Paid | Multi-device POS & captain handhelds, 50 tables, 15 staff accounts, live KDS, raw material inventory & recipes, CRM loyalty insights, online ordering. |
| **Pro** | **₹999 / month** | Commercial Paid | Unlimited stations, 100 tables, 50 staff accounts, live KDS routing, batch inventory tracking, Voice AI hands-free POS, priority phone & WhatsApp support. |
| **Customization** | Bespoke / Custom | Special Solution | Dedicated tier for restaurants requiring custom features, integrations, branding or special requirements. Action: **Contact Us** via **radhachawan01@gmail.com**. |

---

## 5. Security & Multi-Tenant Audit

- **Data Scoping**: Every subscription and billing history query is strictly parameterized by the active tenant's `restaurantId`.
- **Zero Cross-Tenant Leakage**: Verified through unit tests, Firestore security rules, and RBAC matrix.
- **Rule Hardening**:
  ```firestore
  match /restaurants/{restaurantId}/subscription/{subId} {
    allow read: if isTenantStaff(restaurantId);
    allow create, update: if isTenantOwner(restaurantId) || isServer();
    allow delete: if false;
  }
  match /restaurants/{restaurantId}/subscriptionHistory/{historyId} {
    allow read: if isTenantStaff(restaurantId);
    allow create: if isTenantOwner(restaurantId) || isServer();
    allow update, delete: if false; // Immutable audit log
  }
  ```

---

## 6. Verification Status
- **TypeScript**: PASS (0 errors)
- **ESLint**: PASS (0 fatal errors)
- **Vite Production Build**: PASS
- **Unit & Integration Tests**: 121 / 121 test files passing (1,682 / 1,682 tests)
- **Production Hardening**: Webhook OCC transactional idempotency + payment deduplication fully tested across 8 concurrency invariants
- **M10 Status**: Confirmed ON HOLD / DEFERRED (Preserving system stability and focus)
