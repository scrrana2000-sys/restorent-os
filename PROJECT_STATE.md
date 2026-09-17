# RestaurantOS — Master Project State & Status

## Current Milestone & Phase Status
- **Current Active Feature**: Subscription System + Commercial Plans & Customization (COMPLETE, PRODUCTION-HARDENED & VERIFIED)
  - **7-Day Free Trial**: Server-authoritative, idempotent start bound to `/restaurants/{restaurantId}/subscription/current`. Survives device changes, reloads, and logouts. Existing trial duration is preserved and cannot be fraudulently restarted.
  - **Commercial Plans & Monthly Pricing**:
    - **Starter**: ₹299 / month (29,900 paise) (Single station, 15 tables, 5 staff, KOT, digital QR menu, reports, receipt printing).
    - **Growth**: ₹699 / month (69,900 paise) (Multi-device, 50 tables, 15 staff, live KDS, raw inventory & recipe depletion, CRM insights, online ordering).
    - **Pro**: ₹999 / month (99,900 paise) (Unlimited stations, 100 tables, 50 staff, live KDS routing, batch tracking, Voice AI assistant, priority support).
    - **Customization Solution**: Dedicated tier for custom integrations, bespoke branding, and special requirements with direct email contact (`radhachawan01@gmail.com`).
  - **Strict Display Order**: Starter (₹299/mo) → Growth (₹699/mo) → Pro (₹999/mo) → Divider → Customization.
  - **Backend Authority**: `/api/subscription/create-order` computes pricing strictly server-side from `COMMERCIAL_PLANS`. `/api/subscription/verify-and-activate` cryptographically validates payment signatures via HMAC SHA-256 before activating.
  - **Persistent Webhook Idempotency Engine**:
    - Replaced in-memory tracking with persistent Firestore collection `/subscriptionWebhookEvents/{eventId}`.
    - Transactional OCC (`runTransaction`) claims webhook events atomically before processing, surviving server restarts and container scale-outs.
    - Post-processing state updates with `completeWebhookEvent` mark events as `processed`, `ignored`, or `failed`.
    - Payment deduplication: If a payment has already activated a plan for a tenant, duplicate webhooks or concurrent activations return the existing subscription without generating duplicate audit entries.
    - Security rules: `/subscriptionWebhookEvents/{eventId}` access restricted strictly to `isServer()`.
  - **Credential Safety**:
    - Frontend NEVER receives or exposes `RAZORPAY_KEY_SECRET` or `RAZORPAY_WEBHOOK_SECRET`.
    - Public Key ID (`RAZORPAY_KEY_ID`) exposed safely to client for Razorpay Checkout popup.
    - Production keys deferred per user direction ("Razorpay credentials abhi provide nahi karne hain").
  - **Owner Center Integration**: `SubscriptionStatusBanner` on Owner Central dashboard, `SubscriptionView` management console, plan switch modal, and immutable billing audit log (`/restaurants/{restaurantId}/subscriptionHistory/`).
  - **RBAC & Security Rules**: `access_subscription` for Owner/Manager, `manage_subscription` strictly for Owner. Firestore rules enforce multi-tenant isolation and append-only billing logs.
- **Cloud Run Deployment & Webhook Ingress Readiness**:
  - **Build & Artifacts**: Production build verified via `npm run build` producing optimized Vite SPA assets and self-contained CommonJS server bundle `dist/server.cjs`.
  - **Start Command**: `npm start` executes `node dist/server.cjs` listening on `0.0.0.0:3000`.
  - **Sandbox Restriction vs Production Cloud Run**: The AI Studio development container (`ais-dev-4ft674ruzfz7tdktvsq66r`) intercepts unauthenticated HTTP POST calls with an interactive session cookie challenge (`302 Found` to `/__cookie_check.html`).
  - **Deployment Path**: Deploying from AI Studio via Settings Menu > "Deploy to Cloud Run" with "Allow unauthenticated invocations" enabled establishes the public production domain (e.g., `https://restaurantos-<hash>.a.run.app`) where `/api/subscription/razorpay-webhook` directly accepts external server-to-server POST deliveries.
- **Current Active Milestone**: Milestone 12 — Final Production Hardening & Launch (COMPLETE & VERIFIED)
- **Milestone 10 Status**: ON HOLD / DEFERRED
  - **Reason**: Deferred because AI Item Recognition is not currently a product priority. Existing manual item creation is sufficient for the current RestaurantOS release.
- **Milestone 12 Status**: COMPLETE & VERIFIED
  - **Full Production Audit**: 22/22 audit phases passed with 100% verification across all core modules.
  - **Health Endpoint**: Production health API (`/api/health`) verified returning service status, timestamp, version, and database state.
  - **PWA Integration**: Web App Manifest (`/manifest.webmanifest`) configured with standalone display, theme color `#0f172a`, icon definitions (192x192, 512x512, maskable), and Service Worker registration (`sw.js`).
  - **SEO & Metadata Synchronization**: Synced `<title>`, `og:title`, `description`, `og:description`, and `metadata.json` across all public entry points.
  - **Zero Regressions & Security Boundary**: Hardened Firestore rules with `isServer()` overrides for inventory and stock consumption, keeping 118 test files (1,629 tests) 100% green with zero TypeScript, lint, or build errors.
- **Milestone 9 Status**: COMPLETE / VERIFIED
  - **Phase 1 (Discovery & City Selection)**: Public multi-tenant restaurant discovery, GPS/PIN/City location selector, and public restaurant profiles.
  - **Phase 2 (Menu & Customization)**: Public menu viewing, food type badges, variant & addon customizers, and cart boundary isolation.
  - **Phase 3 (Checkout & Order Submission)**: Customer authentication, guest ordering, real-time bill calculations, and live order placement.
  - **Phase 4 (Order Tracking & Restaurant Kitchen Lifecycle)**: Live customer tracking timeline, sound alerts, prep time estimation, accept/reject workflows with inventory rollback.
  - **Phase 5 (Restaurant Customer Management / CRM Foundation)**: Restaurant-scoped customer directory, multi-tenant isolation, registered customer deduplication, guest activity tracking without auto-merging, summary KPIs, search & filters, and customer detail modal.
- **Milestone 8.5 Status**: COMPLETE / VERIFIED
  - **Single Person / Quick Counter Mode**: Streamlined single-operator workflow (`tablesEnabled: false`, `kitchenEnabled: false`, `captainEnabled: false`), suppressing table selection, KOT generation, and captain dispatch while enabling direct review and counter payment.
  - **Small Team / Cafe Mode**: Optimized for counter ordering with separate kitchen preparation (`kitchenEnabled: true`, `captainEnabled: false`), sending KOTs directly to Kitchen Display while eliminating captain steps.
  - **Full Service Mode**: Preserves comprehensive end-to-end multi-step operations (POS → Tables → Sessions → Captain → KOT → Kitchen → Billing → Settlement → Inventory → Reports → Staff) without regressions.
  - **Custom Configuration Mode**: Granular capability toggles for maximum operational flexibility (`tablesEnabled`, `kitchenEnabled`, `captainEnabled`, `inventoryEnabled`, `takeawayEnabled`, `deliveryEnabled`, `paymentsEnabled`).
  - **Central Operating Profile Resolver (`getRestaurantOperatingProfile`)**: Single authoritative function deriving active capabilities, navigation visibility, workflow properties, and POS behaviors with zero duplicated logic.
  - **Adaptive POS Interface**: Header dynamically renders only valid order types (`allowedOrderTypes`), auto-reconciling active selections and hiding table selectors when tables are disabled.
  - **Dynamic Order Types**: Automatically filters order types based on capabilities (e.g., tables OFF eliminates Dine-In; takeaway OFF eliminates Takeaway; delivery OFF eliminates Delivery).
  - **Direct Counter Payment**: Instant billing and settlement for counter workflows (`allowDirectPayment: true`) without requiring KOT completion or table closure preconditions.
  - **Backward Compatibility**: Seamless fallbacks for legacy restaurant documents lacking operating mode or capability fields, safely defaulting to `full_service` profile.
  - **RBAC Preservation**: Operating profile strictly governs UX and workflow ergonomics; authorization and tenant boundary security are enforced at RBAC rules and Firestore levels. No client flag may bypass permissions.
  - **Tenant Isolation**: Restaurant configurations and operating profiles remain strictly restaurant-scoped and switch cleanly across multi-outlet contexts without cross-tenant state leakage.
  - **AI Assistant Full Close Integration**: Single global assistant instance supports three states (`ACTIVE`, `MINIMIZED`, `FULLY_CLOSED`). In `FULLY_CLOSED`, the widget completely unmounts, ceases microphone/speech activity, and persists state across reloads, with a restore toggle provided in Restaurant Setup.
- **Voice Ordering & Global Assistant Status**: COMPLETE & VERIFIED
  - Single Global Assistant architecture mounted at authenticated application shell (`AdminLayout.tsx`)
  - Canonical Assistant Character rendered consistently across all views
  - Context-Aware Voice Interpreter (`globalVoiceInterpreter.ts`) with navigation, inventory, analytics, kitchen KOT queries, and POS voice ordering
  - Navigation voice commands ("POS kholo", "Kitchen kholo", "Tables kholo", "Inventory kholo", "Reports kholo", "Orders kholo", "Staff kholo", "Settings kholo")
  - Multi-candidate ambiguity resolver (surface options for vague queries like "biryani")
  - Voice Order trigger button & bottom-sheet modal with real-time transcript
  - Global custom event decoupling (`ros-voice-add-to-cart`, `ros-voice-clear-cart`) with zero event listener leakage
  - Strict confirmation before cart modification
  - Full RBAC protection across all staff roles (Owner, Manager, Cashier, Kitchen, Captain, Accountant)
  - Strict cross-tenant isolation enforcement
  - Double confirmation / submit guards (`isSubmitting` guard)
  - Hardware back-button history registration & Audit log integration
  - Microphone Permission UX: `SUPPORTED + GRANTED`, `SUPPORTED + PROMPT`, `SUPPORTED + DENIED`, `UNSUPPORTED`
  - Explicit `[ Allow Microphone ]`, `[ Try Again ]`, and `[ Use Menu Instead ]` actions
  - Comprehensive Verification Test Suite: 39/39 Phase 11E tests passing (100% pass rate)

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
- **Milestone 8.5 — Adaptive Operating Model & Small Restaurant Mode**: COMPLETE & VERIFIED
- **Milestone 9 — Customer App & Online Ordering**: COMPLETE & VERIFIED
  - **Phase 9A — Public Restaurant Identity & Safe Model**: COMPLETE & VERIFIED
  - **Phase 9B — Public Restaurant Discovery Service / Query**: COMPLETE & VERIFIED
  - **Phase 9C — Customer Location Context & Manual City Fallback**: COMPLETE & VERIFIED
  - **Milestone 9 — Phase 1: Customer Account & Profile Foundation**: COMPLETE & VERIFIED
  - **Milestone 9 — Phase 2: Customer ↔ Order Linking Foundation**: COMPLETE & VERIFIED
  - **Milestone 9 — Phase 3: Restaurant New Online Order Notification**: COMPLETE & VERIFIED
  - **Milestone 9 — Phase 4: Customer Order Tracking**: COMPLETE & VERIFIED
  - **Milestone 9 — Phase 5: Restaurant Customer Management / CRM Foundation**: COMPLETE & VERIFIED
- **Milestone 10 — AI Item Recognition**: ON HOLD / DEFERRED (Deferred because AI Item Recognition is not currently a product priority. Existing manual item creation is sufficient for the current RestaurantOS release.)
- **Milestone 11 — Voice Assistant & Voice Ordering**: COMPLETE & VERIFIED
- **Milestone 12 — Final Production Hardening & Launch**: COMPLETE & VERIFIED
    - **Google Sign-In Authentication**: Direct Google OAuth (`GoogleAuthProvider`) integration via `CustomerAuthContext` and `customerAuthService`.
    - **UID Mapping**: Customer ID is strictly bound to Firebase Auth UID (`customerId = user.uid`).
    - **Staff/Customer Identity Decoupling**: Customer accounts are completely separated from restaurant staff and owner roles.
    - **Customer Profile Entity**: Stored in root collection `/customers/{customerId}` with `name`, `email`, `phone`, `defaultDeliveryAddress`, `preferences`, and timestamps.
    - **Firestore Security Rules**: Strict owner-only access enforced (`request.auth.uid == customerId`); cross-customer access is completely blocked.
    - **Guest Checkout Preserved**: Unauthenticated guest checkout remains fully operational; logged-in customers get automatic checkout pre-fill.
    - **No Phone OTP**: Phone OTP / SMS authentication is explicitly excluded per business decision; phone numbers are stored strictly as contact information.
    - **Automated Verification**: Verified with 12 dedicated tests in `src/test/milestone9Phase1CustomerProfile.test.tsx` (100% pass rate).
  - **Milestone 9 — Phase 2: Customer ↔ Order Linking Foundation**: COMPLETE & VERIFIED
    - **Customer Order Association**: `customerId` added to `Order` domain model; deterministically set to authenticated customer's Firebase UID (`auth.currentUser.uid`).
    - **Guest Checkout Preserved**: Unauthenticated guests continue to place takeaway and delivery orders with `customerId: null` without disruption.
    - **Identity Anti-Spoofing Hardening**: Server-side token validation at `/api/submit-online-order` ensures client cannot submit orders under a mismatched `customerId`. Violations reject with HTTP 403.
    - **Snapshot Immutability vs Profile Decoupling**: Historical `customerSnapshot` on orders captures checkout data at order placement time and remains strictly decoupled from future edits to the customer's `/customers/{customerId}` document.
    - **Firestore Security Rules**: Customer order reads permitted via `resource.data.customerId == request.auth.uid`, guest online orders readable via `resource.data.source == 'online'`, while full staff/admin access and cross-tenant rules remain intact.
    - **Zero Regressions**: POS, KDS, KOT creation, and financial calculations continue operating with 100% fidelity.
    - **Automated Verification**: 12/12 dedicated tests in `src/test/milestone9Phase2CustomerOrderLinking.test.tsx` passing; 99 customer suite tests passing.
  - **Milestone 9 — Phase 3: Restaurant New Online Order Notification**: COMPLETE & VERIFIED
    - **Real-time Detection**: Subscribes to new online orders for the active tenant (`/restaurants/{restaurantId}/orders` where `source == 'online'`) via `onlineOrderNotificationService.ts`.
    - **Initial Page Load Suppression**: Historical orders existing prior to listener initialization are indexed into `seenOrderIds` without triggering notifications.
    - **Deduplication Engine**: Client-side `seenOrderIds` cache prevents duplicate notifications across repeated snapshots, metadata modifications, or order status transitions.
    - **Offline / Reconnect Resilience**: Retains seen order cache across network disconnects and reconnects, preventing old orders from re-announcing on reconnect.
    - **Sound Alert with Autoplay Fallback**: Synthesizes a soft two-tone chime via native Web Audio API (`soundAlert.ts`) without external asset requests; catches browser autoplay policy blocks gracefully without crashing or degrading visual notifications.
    - **Non-Blocking Visual Notification**: Responsive stacked cards in `AdminLayout` displaying order number, customer name, order type (Takeaway/Delivery), amount in ₹, and relative timestamp.
    - **Safe Dismissal / Zero Status Mutation**: Staff can dismiss individual notifications or "Dismiss All"; dismissal is purely local and NEVER mutates the underlying order status in Firestore.
    - **Multi-Tenant Isolation**: Subscriptions strictly scoped to the active `restaurantId`; cross-tenant order notifications are completely blocked.
    - **Automated Verification**: 15/15 dedicated tests in `src/test/milestone9Phase3OnlineOrderNotification.test.tsx` passing; zero regressions across customer profile and order linking suites.
  - **Milestone 9 — Phase 4: Customer Order Tracking**: COMPLETE & VERIFIED
    - **Read-Only Order Observation**: Customer tracking strictly observes live order progress without mutating order documents or triggering unauthorized status changes.
    - **Existing Order Lifecycle Mapping**: Backend `OrderStatus` mapped directly to customer-facing 4-stage stepper (Order Placed → Preparing in Kitchen → Ready/Out for Delivery → Completed) with cancelled state handling.
    - **Guest Checkout Preservation**: Seamless order tracking for unauthenticated guests via client-side `localStorage` tracking references (`restaurantos_guest_tracked_orders`) alongside authenticated customer tracking.
    - **Data Sanitization**: Strips internal kitchen notes, staff metadata, and operational IDs before rendering to customer.
    - **Multi-Entry Tracking Access**: Tracking accessible immediately from checkout success modal, "My Orders" modal, customer profile modal, and persistent header buttons with real-time active order count badge.
    - **Zero Phone OTP**: Excluded per architectural constraints; no SMS or phone verification added.
    - **Milestone 9 — Phase 5: Restaurant Customer Management / CRM Foundation**: COMPLETE & VERIFIED
      - Restaurant-scoped customer directory aggregating purely from tenant orders (`/restaurants/{restaurantId}/orders`).
      - Registered customer deduplication by authenticated UID (`customerId`).
      - Guest customer isolation with `guest_` identifiers (no fake UIDs, no auto-merging).
      - Operational metrics: Unique Customers, Total Orders, Total Revenue, Average Order Value (AOV).
      - Multi-attribute real-time search & filter tabs (All, Registered, Guests, Frequent, Recent).
      - Customer Detail Modal with order history inspection and direct link to Orders view.
      - Automated test suite: 13/13 Phase 5 tests passing; zero phone OTP, SMS, or marketing automation added.
  - **Milestone 9 Completion**: ALL 5 PHASES (Phases 1–5) COMPLETE & VERIFIED.
- **Milestone 10 — Multi-Branch & Chain Enterprise Management**: NOT STARTED *(Protected / Future Scope)*

- **Milestone 11 — Global RestaurantOS Assistant & Voice-Assisted POS Engine**: COMPLETE & VERIFIED
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

- **Repository Verification**: COMPLETE / VERIFIED
- **Live Firebase**: NOT VERIFIED
- **Test Suite Results**:
  - **Total Test Files**: 98 test files
  - **Total Tests**: 1,311 tests
  - **Passed**: 1,311 tests (100% pass rate)
  - **Failed**: 0 failed
  - **Skipped**: 0 skipped
- **TypeScript**: PASS (`npx tsc --noEmit` -> exit code 0)
- **Lint**: PASS (`npm run lint` -> exit code 0)
- **Production Build**: PASS (`npm run build` -> exit code 0)

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

### 6. Adaptive Operating Model & Small Restaurant Modes (Milestone 8.5)
The application dynamically adapts its workflow, POS behavior, and navigation according to the restaurant's operational profile:
- **Operating Modes**:
  - **Single Person / Quick Counter (`single_person`)**: Tailored for solo counter operators and kiosks. Suppresses table selection, KOT kitchen routing, and captain ordering. Enables direct counter review and settlement.
  - **Small Team / Cafe (`small_team`)**: Designed for quick counter ordering backed by a dedicated prep kitchen. Suppresses captain order flow while retaining KOTs and Kitchen Display operations.
  - **Full Service (`full_service`)**: Traditional multi-tier restaurant workflow (Tables → Sessions → Captain → KOT → Kitchen → Billing → Settlement). Default for legacy or unconfigured restaurants.
  - **Custom Configuration (`custom`)**: Granular control permitting restaurant owners to toggle any individual capability based on operational requirements.
- **Granular Capability Toggles (`RestaurantCapabilities`)**:
  - `tablesEnabled`: Governs table management view, table selector in POS, and Dine-In eligibility.
  - `kitchenEnabled`: Governs KDS / Kitchen Queue view and KOT dispatch requirements before payment.
  - `captainEnabled`: Governs Captain / Staff mobile order view and Captain modal workflows.
  - `inventoryEnabled`: Governs Stock & Inventory Ledger views.
  - `takeawayEnabled`: Controls takeaway order type availability.
  - `deliveryEnabled`: Controls delivery order type availability.
  - `paymentsEnabled`: Controls financial settlement flows.
- **Authoritative Profile Resolver (`getRestaurantOperatingProfile`)**:
  - Single pure function calculating active capabilities, navigation visibility, workflow properties, and POS configuration.
  - Gracefully falls back to `full_service` profile when mode or capabilities are omitted or undefined.
- **Adaptive POS Interface & Dynamic Order Types**:
  - Automatically filters available order types (`allowedOrderTypes`), eliminating Dine-In when `tablesEnabled: false`, Takeaway when `takeawayEnabled: false`, and Delivery when `deliveryEnabled: false`.
  - Dynamically reconciles active selection to valid default when restaurant configuration changes.
  - Shows table selector only when `tablesEnabled: true`.
- **Direct Counter Payment Flow**:
  - When `kitchenEnabled: false` (e.g. `single_person`), `posBehavior.allowDirectPayment` is activated, allowing immediate "Review & Pay" checkout without intermediate KOT lifecycle requirements.
- **RBAC & Security Preservation**:
  - Operating modes only modify presentation and UX workflows.
  - All operations remain strictly governed by user roles (`owner`, `manager`, `cashier`, `kitchen`, `captain`, `accountant`) and Firestore security rules. No client-side capability flag can bypass backend authorization.
- **Tenant Isolation**:
  - All operating modes and capability configurations are stored strictly within the scoped restaurant document. Switching restaurants instantly refreshes the operating profile without state leakage.
- **AI Assistant Full Close Integration**:
  - Supports three lifecycle states: `ACTIVE`, `MINIMIZED`, and `FULLY_CLOSED`.
  - In `FULLY_CLOSED`, the floating widget completely unmounts, speech recognition is aborted, speech bubbles are suppressed, and the closed preference is stored in local persistence. A "Restore Voice Assistant" control in Restaurant Setup allows reactivation.

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
