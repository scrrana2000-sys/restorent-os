# Changelog — RestaurantOS

## [Production Candidate Security & Pipeline Hardening] - 2026-09-18

- Made Firestore order and KOT creation server-authoritative; browser workflows use authenticated API boundaries.
- Made order stock-lock mutations server-only.
- Hardened Razorpay webhook idempotency so failed deliveries retry and stale processing claims can be reclaimed after 10 minutes.
- Added strict POS source/order-type validation and fixed omitted client-request IDs from becoming shared idempotency keys.
- Disabled direct restaurant document deletion to prevent orphaned tenant subcollections; controlled backend purge can be added later.
- Updated release/security documentation to distinguish static verification from dependency-backed CI verification.

All notable changes to RestaurantOS will be documented in this file.

## [Cloud Run Deployment Readiness & Public Webhook Verification] - 2026-09-17

### Deployment Infrastructure & Production Ingress
- **Cloud Run Deployment Architecture**:
  - Full-stack production build verified: Single artifact build via `npm run build` compiles Vite SPA assets into `dist/` and compiles server entry point into self-contained CommonJS bundle `dist/server.cjs` via `esbuild`.
  - Production start command verified: `npm start` (`node dist/server.cjs`) binds to `0.0.0.0:3000` with native static file serving and fallback SPA routing.
  - Development Sandbox Isolation Verified: In the AI Studio development environment (`ais-dev-4ft674ruzfz7tdktvsq66r`), inbound requests are protected by an internal reverse-proxy security gate with session cookie redirects (`/__cookie_check.html`).
  - Public Webhook Prerequisite: External automated callers like Razorpay require an unauthenticated public Cloud Run endpoint without interactive browser session challenges. Cloud Run service-level unauthenticated invocation must be enabled when deploying from AI Studio settings or Cloud Run console.
- **Backend API Endpoints Documented**:
  - `POST /api/subscription/create-order`: Server-authoritative order creation from commercial catalog.
  - `POST /api/subscription/verify-and-activate`: Cryptographic HMAC SHA-256 payment signature verification & immediate plan activation.
  - `POST /api/subscription/razorpay-webhook`: Persistent Firestore transactional OCC idempotency engine with HMAC SHA-256 signature verification.
  - `GET /api/health`: Authenticated/unauthenticated production service health indicator.
- **Secret Hygiene & Security Invariants**:
  - Zero secrets exposed in documentation, client bundles, or frontend code.
  - Server secrets (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) remain strictly server-side.
  - All existing tenant isolation, RBAC matrices, and Firestore security rules remain strictly preserved.

## [Subscription System — Commercial Plans, Pricing & Customization] - 2026-09-17

### Commercial Plan Configuration & Customization
- **Finalized Commercial Pricing & Tier Definitions**:
  - **Starter**: ₹299 / month (Single POS station, 15 tables, 5 staff accounts, KOT generation, digital QR menu, daily reports, receipt printing).
  - **Growth**: ₹699 / month (Multi-device POS & captain handhelds, 50 tables, 15 staff accounts, live KDS, raw material inventory & recipe depletion, customer CRM insights, online ordering).
  - **Pro**: ₹999 / month (Unlimited stations, 100 tables, 50 staff accounts, live KDS routing, batch tracking, Voice AI assistant, priority phone & WhatsApp support).
- **Centralized Configuration (`src/config/subscriptionPlans.ts`)**:
  - Centralized plan definitions, minor-unit (paise) and rupee calculations, and strict ordering (`COMMERCIAL_PLANS`).
  - Added dedicated `CUSTOMIZATION_CONFIG` for bespoke restaurant integrations, custom branding, and specialized requirements.
- **Customization Solution Section**:
  - Rendered as a separate, distinct section with clear divider in Owner Center (`SubscriptionView.tsx`).
  - Displays "Need a Custom Solution?", "Customization", and description.
  - Dedicated "Contact Us" mailto action to official email: `radhachawan01@gmail.com`.
  - Non-checkout architecture: completely decoupled from standard self-serve payment flows.
- **Owner Center UI & Subscription Experience**:
  - Updated plan display order: Starter (₹299/mo) → Growth (₹699/mo) → Pro (₹999/mo) → Divider → Customization.
  - Transparent monthly pricing with operational limit badges and capability lists.
  - Maintained 7-day free trial banner with "Choose a Plan" action.
- **Testing & Verification**:
  - Expanded test coverage in `src/test/subscriptionSystem.test.ts` verifying exact pricing, currency (INR), plan ordering, customization email, trial immutability, RBAC permissions, and payment order calculations.
  - 120/120 test files passing (1,652 total tests green), 0 lint errors, clean production build.

## [Milestone 12 — Final Production Hardening & Launch] - 2026-09-17

### Production Hardening & Audit Completion
- **Full Production System Audit**: Completed 22/22 audit phases covering security, tenant isolation, POS, inventory, online ordering, CRM, hardware/printers, offline synchronization, and voice assistant modules.
- **Service Health Check Endpoint (`/api/health`)**: Verified production Express endpoint returning service status, ISO timestamp, version, and server authentication health.
- **Progressive Web App (PWA) Manifest & Service Worker**:
  - Configured Web App Manifest (`/manifest.webmanifest`) with standalone display, `#0f172a` theme color, and compliant icon definitions (192x192, 512x512, maskable).
  - Registered Service Worker (`/sw.js`) handling app shell caching, static asset precaching, and offline fallback strategy.
  - Added app installability links and iOS Safari meta headers in `index.html`.
- **Firestore Security Rules Hardening**: Added `isServer()` overrides for inventory and stock ledger operations to prevent permission issues during server-side order processing.
- **SEO & App Metadata Synchronization**: Aligned `<title>`, `og:title`, `<meta name="description">`, `og:description`, and `metadata.json` across entry points.
- **Verification Suite**: 118 test files (1,629 total tests) passing 100% green with 0 linter errors, 0 TypeScript errors, and clean production build.

## [Milestone 10 — AI Item Recognition] - 2026-09-17

### Deferred / On Hold
- **Status**: ON HOLD / DEFERRED.
- **Reason**: Deferred because AI Item Recognition is not currently a product priority. Existing manual item creation is sufficient for the current RestaurantOS release.
- **Roadmap Retention**: All M10 specifications and requirements preserved in `PROJECT_SPEC.md` for potential future implementation.

## [Milestone 9 — Phase 5: Restaurant Customer Management / CRM Foundation] - 2026-09-16

### Added & Verified
- **Restaurant Customers & CRM Module (`CustomersPage.tsx`)**:
  - Integrated into the RestaurantOS admin console navigation sidebar (`Sidebar.tsx`) with the `UserCheck` icon.
  - Enabled across all operating profiles via `isCustomersVisible` property.
  - RBAC protection: allows `owner`, `manager`, and `cashier` (`access_customers` / `view_customers` permissions) while strictly denying `kitchen`, `captain`, and `accountant`.
- **Tenant Isolation & Aggregation Engine (`restaurantCustomerService.ts`)**:
  - Aggregates customer data purely from tenant orders (`/restaurants/{restaurantId}/orders`), guaranteeing strict isolation between restaurants.
  - Registered customer deduplication: multiple orders by the same authenticated customer UID are consolidated into a single profile.
  - Guest order handling: guest orders (`customerId: null`) are kept distinct with `guest_` prefix IDs and never converted to fake registered UIDs or auto-merged.
- **Operational Metrics & KPIs**:
  - Executive overview cards: Unique Customers (with registered/guest counts), Total Orders, Total Revenue, and Average Order Value (AOV).
- **Search & Filter Controls**:
  - Multi-attribute real-time search: customer name, email, phone number, and UID.
  - Category filter tabs: All Customers, Registered Accounts, Guest Activity, 2+ Orders (Frequent), and Last 30 Days (Recent).
- **Customer Detail Modal (`CustomerDetailModal.tsx`)**:
  - Complete contact card and identity badge.
  - Order history table displaying order IDs, status badges, item summaries, totals, and timestamps.
  - Direct "View Order" navigation integration into the Orders view.
- **Verification Test Suite**:
  - Unit test suite: `src/test/milestone9Phase5RestaurantCustomerManagement.test.tsx` (13/13 tests passing).
  - Strict anti-regression checks: verified zero phone OTP, SMS, email marketing, or AI scoring features.

## [Milestone 9 — Phase 4: Customer Order Tracking & Online Orders Queue] - 2026-09-16

### Added & Verified
- **Customer Online Order Tracking & Real-Time Timeline**:
  - Live Firestore subscription (`subscribeToOrderTracking`) for `/restaurants/{restaurantId}/orders/{orderId}`.
  - Read-only observation with strict isolation: customer tracking cannot mutate order status or trigger lifecycle transitions.
  - Data sanitization (`sanitizeCustomerOrder`): strips internal kitchen, captain, and server notes or private metadata before displaying to customer.
  - Lifecycle step mapper (`getCustomerStatusDetails`): seamlessly maps backend `OrderStatus` (`draft`, `confirmed`, `sentToKitchen`, `preparing`, `ready`, `served`, `completed`, `cancelled`) into 4 customer-friendly timeline stages with adaptive labels for takeaway vs. delivery.
  - Local tracking persistence (`saveTrackedOrder`, `getSavedTrackedOrders`, `getActiveOrdersCount`): preserves order references in `localStorage` for both signed-in customers and guest diners across browser sessions.
  - Visual Order Tracking Timeline Component (`OrderStatusTimeline.tsx`) with active animations, estimated time remaining countdown, acceptedAt, estimatedPrepMinutes, and readyAt synchronizations.
  - Customer Order Tracking Modal (`CustomerOrderTrackingModal.tsx`) and "My Orders" Modal (`CustomerMyOrdersModal.tsx`).
- **Online Orders Queue Management & POS Integration**:
  - Unified tabbed queue navigation (`All`, `Pending Action / New`, `In Kitchen`, `Ready for Handover`, `Online History`).
  - Order Acceptance workflow with 5 preset preparation times (`15m`, `20m`, `30m`, `45m`, `60m`) and custom preparation time input.
  - Sets `estimatedPrepMinutes`, `acceptedAt`, and `estimatedReadyAt` timestamps on the order and automatically updates customer live timeline.
  - Order Rejection modal with standard preset rejection reasons (`Items out of stock`, `Kitchen at maximum capacity`, `Outside delivery radius`, `Closing soon / Kitchen closed`) and custom explanation.
  - Reserved inventory restitution on rejection: automatically restores reserved stock items to available inventory.
  - Idempotent double-rejection and double-completion safeguards.
  - Bill printing integration and sound alert toggle controls.
- **Verification & Audit Suite**:
  - `src/test/milestone9Phase4FinalVerification.test.tsx`: 23/23 audit tests passing.
  - `src/test/milestone9Phase4CustomerOrderTracking.test.tsx`: 15/15 customer tracking tests passing.
  - Total Milestone 9 test suite passing: 77/77 tests (Phases 1, 2, 3, 4).
- **Strict Boundary Confirmation**:
  - Phone OTP / SMS verification was NOT implemented (uses direct PIN and Google Auth).
  - Phase 5 (Customer CRM / Management) was NOT started and remains protected for future scope.

## [Milestone 9 — Phase 3: Restaurant New Online Order Notification] - 2026-09-16

### Added & Verified
- **Realtime Online Order Detection (`onlineOrderNotificationService.ts`)**:
  - Subscribes to `/restaurants/{restaurantId}/orders` where `source == 'online'` for authorized staff.
  - Initial page load suppression: historical orders existing prior to listener initialization are indexed into `seenOrderIds` without alerting.
  - Deterministic deduplication engine prevents duplicate notifications across repeated snapshots, metadata modifications, or order status transitions.
  - Reconnect resilience: retains seen order cache across network disconnects and reconnects, preventing old orders from re-announcing upon offline-to-online transitions.
  - Non-online order filtering: ignores POS dine-in, captain, and admin orders.
  - Burst support: cleanly processes batches of incoming online orders and queues them without race conditions.
- **Web Audio API Sound Alert (`soundAlert.ts`)**:
  - Synthesizes a clean two-tone chime (587.33 Hz / 880 Hz) using native `AudioContext` without external audio file requests.
  - Handles browser autoplay policy restrictions gracefully with try/catch and Promise rejection recovery, ensuring visual notifications are never blocked.
  - Provides a mute/unmute control for kitchen/POS staff.
- **Visual Notification Card (`NewOnlineOrderNotification.tsx`)**:
  - Displays high-contrast alert card with order number, customer name, order type badge (Takeaway/Delivery), amount in ₹, and relative timestamp.
  - Features a multi-order indicator when multiple orders arrive close together.
  - Primary "[VIEW ORDER]" action navigates directly to Kitchen Display or Orders view based on restaurant operating mode.
  - Dismiss / "Dismiss All" actions clear notifications locally without mutating the order document or changing `order.status` in Firestore.
- **Global Mounting in `AdminLayout.tsx`**:
  - Mounted directly in `AdminLayout` so authorized staff on KDS, POS, Orders, or Dashboard views receive immediate real-time alerts.
- **Automated Verification Suite**:
  - Created `src/test/milestone9Phase3OnlineOrderNotification.test.tsx` verifying all 15 required functional and edge-case scenarios (100% pass rate).
  - Regression tested with Milestone 9 Phase 1 and Phase 2 test suites (100% pass rate).
  - Full TypeScript check (`npm run lint`) and production build (`npm run build`) succeeded with zero errors.

## [Milestone 9 — Phase 2: Customer ↔ Order Linking Foundation] - 2026-09-16

### Added & Verified
- **Customer ↔ Order Linking Architecture**:
  - Attached optional `customerId` (`string | null`) to the authoritative `Order` domain model (`src/types/order.ts`).
  - Set `customerId` strictly to the authenticated customer's Firebase UID (`auth.currentUser.uid`) when signed in.
  - Retained `customerSnapshot` on orders containing name, phone, email, and delivery address to maintain immutable historical records at the moment of order placement.
  - Preserved decoupling between historical order snapshots and the customer profile at `/customers/{customerId}` (profile edits do not rewrite past order snapshots; past order snapshots do not corrupt the customer profile).
- **Guest Checkout Preservation**:
  - Full guest checkout remains supported: when guest submits an order without signing in, `customerId` defaults to `null` or is omitted.
  - Zero disruption to guest online ordering or guest checkout modal flows.
- **Spoofing Prevention & Identity Hardening**:
  - Hardened `/api/submit-online-order` in `server.ts` and `customerCheckoutService.ts`.
  - When an order request provides `customerId`, it must strictly match the authenticated user token decoded via `verifyFirebaseToken` (`auth.currentUser.uid === customerId`).
  - Direct spoofing attempts (submitting Customer B's UID while authenticated as Customer A) are rejected with HTTP 403 / Security Violation error.
- **Firestore Security Rules**:
  - Updated `/orders/{orderId}` rules in `firestore.rules`:
    - Owning customers can read their own orders (`resource.data.customerId == request.auth.uid`).
    - Guest online orders (`resource.data.source == 'online'`) remain accessible for guest tracking.
    - Restaurant staff (`staff` or `admin`) continue to read/write all tenant orders as governed by operational RBAC.
    - Arbitrary public reads (`allow read: if true;`) remain strictly prohibited.
- **KDS, POS, and Operational Invariants Preserved**:
  - Zero regression in KDS kitchen queue and KOT creation (`OrderService.createOrderAndKOTFromCart`).
  - KOT generation receives online customer-linked orders seamlessly with strict separation of operational concerns (KOT carries kitchen preparation items without financial amounts).
  - Indian GST calculations (CGST/SGST minor units), tax calculations, discounts, and payment status lifecycle flow without modification.
- **Automated Verification Suite**:
  - Created `src/test/milestone9Phase2CustomerOrderLinking.test.tsx` covering all 12 required verification scenarios (100% pass rate).
  - Verified 99 tests across all customer discovery, cart, checkout, profile, and order linking suites.
  - Production build and TypeScript lint checks passing with zero errors.

## [Milestone 9 — Phase 1: Customer Account & Profile Foundation] - 2026-09-16

### Added & Verified
- **Customer Authentication via Google Sign-In**:
  - Implemented `customerAuthService.ts` and `CustomerAuthContext.tsx` providing Google Sign-In (`signInWithPopup`), auto-provisioning customer profiles upon first login, real-time profile listener, and sign-out.
  - Strictly coupled `customerId` with Firebase Auth UID (`auth.currentUser.uid`).
  - Separated customer authentication from restaurant staff and owner back-office authentication.
- **Customer Profile Entity & Management**:
  - Schema defined in `/customers/{customerId}` storing name, email, phone, default delivery address, saved addresses, preferences, and timestamps.
  - Implemented `CustomerProfileModal.tsx` allowing customers to view, update contact info, manage delivery addresses, and sign out with responsive mobile/desktop drawer presentation.
  - Added account trigger button in `CustomerRestaurantMenuPage.tsx` and `PublicCustomerDiscoveryPage.tsx` showing customer avatar and quick access to profile or Google sign-in.
- **Customer Checkout Integration & Guest Compatibility**:
  - `CustomerCheckoutModal.tsx` seamlessly auto-fills customer details (name, phone, saved address) when signed in while retaining full guest checkout capability for non-authenticated users.
  - Embedded one-click "Sign in with Google" prompt inside checkout modal for guests wishing to pre-fill their profile.
- **Firestore Security Rules Isolation**:
  - Configured `/customers/{customerId}` security rules in `firestore.rules` allowing read/write strictly when `request.auth != null && request.auth.uid == customerId`.
  - Customer A cannot read or write Customer B's profile.
  - Unauthenticated access is rejected.
  - Existing restaurant tenant security rules, admin access, POS, and KDS rules remain unmodified and intact.
- **Explicit Prohibition of Phone OTP**:
  - Phone OTP / SMS authentication is intentionally omitted; phone number is treated strictly as an informational contact field.
- **Automated Verification Suite**:
  - Created `src/test/milestone9Phase1CustomerProfile.test.tsx` containing 12 comprehensive unit and integration tests (100% pass rate).
  - Verified zero regressions across customer checkout, online order submission, and firestore security audit test suites.

## [Phase 4.6 / Phase 4.5 / M8 — Performance Optimization, Payment Due Center, Table Label Resolution & Firebase Migration] - 2026-09-12

### Added & Optimized
- **POS Payment Due / Collection Center (Phase 4.5)**:
  - Built `PaymentDueCenterModal.tsx` directly accessible from POS to track and collect unpaid and partially paid Dine-In and Takeaway/Parcel orders.
  - Realtime auto-removal from collection center upon full payment settlement (`dueAmountMinor === 0`).
  - Clear taxonomy distinction between Payment Due (uncollected operational balances), Payment History (recorded financial tenders), and Orders History (finalized/cancelled orders).
- **Table Label Resolution & Masking Bug Fix**:
  - Resolved Dine-In table numbers/names (e.g., `Table 1`, `Table 5 (Patio VIP)`) using restaurant-scoped table mapping.
  - Strictly masked internal table document IDs (e.g. `LUBEOOUHBP7RL8HMZV0H`), session IDs, and transaction IDs across all user-facing views.
  - Verified via 15 unit/integration tests in `src/test/paymentDueTableLabel.test.ts`.
- **POS Active Order Consolidation & 2-Minute KOT Grace Cancellation**:
  - When adding items to an active Dine-In table session, POS appends items to the existing open order rather than creating duplicate fragmented orders.
  - Implemented 2-minute grace period rule for KOT cancellations from POS: auto-cancels associated waiting KOTs if cancelled within 2 minutes; restricts cancellation after 2 minutes to the KDS/kitchen view to prevent food wastage.
- **Performance Optimizations (Phase 4.6)**:
  - Route-level code-splitting with `React.lazy` and `Suspense` across `InventoryPage`, `CaptainPage`, `ReportsPage`, `StaffPage`, `KitchenPage`, `OrdersPage`, `PaymentsPage`, `AuditPage`, and `AcceptInvitationPage`.
  - `React.memo` on high-frequency UI components (`MenuItemCard`, `KotCard`, `TableCard`).
  - `useCallback` and `useMemo` stabilization in POS Terminal and `RestaurantContext`.
  - Scoped active operational subscriptions to active/non-terminal records to prevent unbounded reads.
  - Sandbox performance benchmarks recorded (Initial load: 680ms, POS usable: 180ms, KOT dispatch: 140ms).
- **Authoritative Firebase Environment Migration**:
  - Primary production Firebase project ID updated to `project-0edd3716-fc3b-40b7-b96`.
  - Storage bucket set to `project-0edd3716-fc3b-40b7-b96.firebasestorage.app`.
  - Auth domain set to `project-0edd3716-fc3b-40b7-b96.firebaseapp.com`.
  - Named Firestore database set to `ai-studio-restaurantos-16bfb108-09a4-44fb-9463-1d58d938bd57`.
  - Deprecated legacy project `restaurantos-e31b2`.
- **Verification Suite**:
  - Complete repository test suite passing across 81 test files with 100% pass rate.
  - Production build (`npm run build`), TypeScript check (`npx tsc --noEmit`), and linter (`npm run lint`) all pass cleanly.


## [Milestone 6 — Phase 6F: Production Hardening, Backend Authorization & Final Verification] - 2026-09-10

### Added & Hardened
- **Server-Side Authorization Boundary**:
  - Implemented `verifyInvitationCaller` in `src/server/invitationAuth.ts` verifying caller identity and roles (`owner`, `manager`) via Firebase Auth ID tokens.
  - Express endpoint `/api/send-invitation-email` requires an `Authorization: Bearer <token>` header; unauthenticated calls return 401 Unauthorized.
- **Authoritative Server Resolution**:
  - Backend derives restaurant name and employee role directly from verified Firestore documents (`restaurants/{restaurantId}` and `restaurants/{restaurantId}/members/{invitationId}`).
  - Client-supplied `restaurantName` and `role` parameters are rejected/overridden, preventing invitation spoofing or phishing.
- **Cryptographic Token Security & Audit Redaction**:
  - Invitation tokens use 64-character hexadecimal CSPRNG random bytes.
  - Added `createTokenFingerprint` and `sanitizeAuditMetadata` in `auditService.ts` ensuring raw invitation tokens are never stored in audit logs.
- **In-Memory Rate Limiting**:
  - Sliding-window rate limiting on invitation dispatch (10 requests per 10 minutes per IP/caller) with automatic cleanup.
- **Automated Security Suite**:
  - Created `src/test/phase6fProductionHardeningAndBackendSecurity.test.ts` with 25 penetration, privilege escalation, and injection tests.
  - Complete repository test suite passes with **763 tests across 58 test files (100% pass rate)**.

## [Milestone 6 — Phase 6E: Staff Accounts + Role Management & Invitation Claiming] - 2026-09-10

### Added & Hardened
- **Staff Invitation Decoupling**:
  - Separated staff invitation records (`status: 'pending_setup'`, `isActive: false`) from Firebase Auth user account creation.
  - Owners no longer create passwords or overwrite Firebase Auth accounts for employees.
  - Employees claim invitations using `/accept-invitation?token=...`, verifying email matching and email verification status.
- **Multi-Tenant Login & Restaurant Assignment**:
  - Implemented `claimPendingInvitationsForUser` linking authenticated employee UIDs to their pending memberships upon login.
  - Preserved root owner immutability; owners cannot be demoted or deactivated via staff management subcollections.
- **Email Delivery Integration**:
  - Integrated Resend, SendGrid, and SMTP providers in `emailService.ts` with fallback to QR code and copyable invitation links.

## [Milestone 6 — Phase 6A: Role & Permission Foundation] - 2026-09-09

### Added & Verified
- **Phase 6A Role & Permission Foundation**:
  - Established and hardened the complete role and permission matrix across all 6 roles: Owner, Manager, Cashier, Captain, Kitchen, and Accountant.
  - Hardened static permission definitions in `src/utils/permissions.ts` across 19 granular operational and administrative actions.
  - Implemented dynamic membership checking with `cleanRestaurantId` validation guard, ensuring blank, forged, or cross-tenant restaurant parameters are safely rejected.
  - Enhanced UI navigation guards (`isViewAllowed`) across `Sidebar.tsx` and `App.tsx` ensuring zero unauthorized feature exposure.
  - Integrated service-layer security enforcement via `enforcePermission` in `orderService`, `paymentService`, `kotService`, `menuService`, `tableSessionService`, `tableService`, and `auditService`.
  - Hardened Firestore Security Rules in `firestore.rules` to restrict payments read access strictly to `owner`, `manager`, `cashier`, and `accountant`, preventing unauthorized financial visibility on Kitchen or Captain devices.
  - Protected audit logs with immutable security rules and service-level access checks.
  - Added comprehensive automated test suite (`src/test/rolePermissions.test.ts`) validating all 20 required verification scenarios for Phase 6A.
  - Verified 100% test pass rate, TypeScript compilation, and zero regression across existing M1-M5, Table Management, and security suites.

## [Milestone 5 — Business Analytics, Reports, Multi-Outlet & Audit Viewer] - 2026-09-09 — Final Completion & Locked Snapshot

### Added & Verified
- **Milestone 5 Completion & Locked Status**:
  - Successfully implemented and verified all four phases of Milestone 5: 5A, 5B, 5C, and 5D.
- **Phase 5A — Financial & Analytical Calculation Core (`analyticsService.ts`)**:
  - Implemented authoritative, pure functional reporting calculations in integer minor units (paise).
  - Enforced bounded query ranges (maximum 90-day window) to prevent client/database resource exhaustion.
  - Aggregated Gross Sales, Net Sales, Tax (CGST/SGST/IGST), Discounts, Payments by tender (Cash/UPI/Card), Refunds, AOV, and top item/category performance metrics.
- **Phase 5B — Reports Dashboard & Visualizations (`ReportsDashboard.tsx`)**:
  - Built full-featured interactive analytics dashboard with Recharts visualizations, date range presets, and GST liability breakdowns.
  - Enforced permission-aware access guarding (`isViewAllowed(role, 'reports')`) restricting financial reports to owners and managers.
  - Delivered responsive layout with accessible zero-states, metric cards, and loading skeletons.
- **Phase 5C — Multi-Outlet Context Management (`RestaurantContext.tsx`, `firestore.rules`)**:
  - Implemented secure multi-outlet discovery for owners (`ownerId == auth.uid`) and staff via active `members` subcollections.
  - Hardened Firestore Security Rules with a dedicated collection group read rule requiring `isSignedIn() && resource.data.userId == request.auth.uid && resource.data.isActive == true`.
  - Implemented secure outlet switching with full listener teardown, preventing memory leaks or cross-tenant event contamination.
  - Standardized all application components on the canonical `restaurant.restaurantId` property.
  - Enforced automatic eviction of invalid or forged `restaurantId` values stored in `localStorage`.
  - Preserved originating `restaurantId` on all queued offline mutations across context switches.
- **Phase 5D — Immutable Audit Log Viewer (`AuditLogPanel.tsx`)**:
  - Created read-only audit viewer with cursor-based document pagination (`startAfter`) and multi-criteria filtering (Action, Entity, Actor, Date).
  - Enforced strict bounded page sizes (25/50 items) and client-side sanitization/masking of sensitive payload data.
  - Gated access to authorized administrative roles (`owner`, `manager`) with immutable rule enforcement (`allow update, delete: if false`).
- **Security & Multi-Tenant Enforcement**:
  - Rigorously maintained `auth.uid !== restaurantId` decoupling across all subcollections and service calls.
  - Verified that client storage is never treated as an authorization mechanism.
- **Verification & Testing**:
  - Complete repository test suite passed with **100% success rate across 47 test files and 523 individual tests**.
  - TypeScript check: PASS (`tsc --noEmit`).
  - Linter check: PASS (`npm run lint`).
  - Production build: PASS (`npm run build`).
  - All milestone regressions verified: M1 (PASS), M2 (PASS), M3 (PASS), M4 (PASS), M5 5A–5D (PASS).

## [Milestone 4 — Final Security Patch & Acceptance Audit] - 2026-09-08 — Operational UX, Offline Resilience & Security Hardening

### Added & Verified
- **Active Member Security Guard (`firestore.rules`)**:
  - Enforced that only active members (`isActive == true` and `status != 'inactive'`) can query and mutate restaurant subcollections.
- **Table Session Permissions Hardening (`firestore.rules`)**:
  - Captains and cashiers can update physical tables exclusively via session-related locking keys (`activeSessionId` and `updatedAt`) to prevent privilege escalation.
- **Audit Logs Actor Integrity Hardening (`firestore.rules`)**:
  - Restructured client-created audit logs to strictly enforce `request.resource.data.actorUid == request.auth.uid`, preventing any client-side spoofing or impersonating of the `"system"` actor. Documented that future administrative system logs require an authoritative server-side/backend mechanism.
- **Restaurant Root Document Protection (`firestore.rules`)**:
  - Hardened access to `/restaurants/{restaurantId}` so that direct lookup `get` permissions are bound to the authoritative active-membership security model (`isMemberOfRestaurant(restaurantId)`), ensuring inactive or suspended members cannot access private restaurant data.
- **Staff Connection Resolution (`src/context/RestaurantContext.tsx`)**:
  - Fixed a critical connection blocker where non-owner staff members (Captains, Cashiers) were stuck on "Connecting to Firestore..." because Strategy 1 (cached storage lookup) and Strategy 2 (profile lookup) were checking if `found.ownerId === user.uid`. Expanded logic to check active membership status securely via their `members/{userId}` subcollection document to allow full, correct restaurant resolution.
- **Complete Phase 4I Offline Resilience Suite (`src/test/phase4iOfflineResilience.test.ts`)**:
  - Fully implemented all 26 distinct operational resilience scenarios including bounded queue capacity, network status tracking, flapping network simulation, duplicate enqueuing prevention, idempotency verification, external card/UPI offline blocking safeguards, and logout cache clears.
- **Comprehensive Security Attack Suite (`src/test/securityAttacks.test.ts`)**:
  - Created a robust, dedicated attack simulation test suite covering 20 security scenarios, 7 audit integrity checks, 6 table/session locking invariants, and formal simulator tests confirming rules evaluation for `actorUid` spoofing and inactive user access.
- **Verification & Testing**:
  - Complete repository test suite passed with **100% success rate across 43 test suites/files, 1 setup file, and 449 individual tests**.

## [Milestone 4 — Phase 4E] - 2026-09-08 — Table & Session Operations

### Added & Verified
- **Table Session Service Enhancements (`src/services/tableSessionService.ts`)**:
  - Implemented `updateGuestCount(restaurantId, sessionId, newGuestCount, updatedBy)` with atomic transaction checks enforcing session state (`'open'`), capacity limits ($1 \le \text{guestCount} \le \text{capacity}$), and operational audit logging.
  - Wired operational audit event creation (`session_opened`, `session_guest_count_updated`, `session_closed`) into `auditService`.
- **Offline & Idempotency Queue Integration (`src/services/offlineSyncService.ts`, `src/types/idempotency.ts`)**:
  - Extended `IdempotencyOperation` and `offlineSyncService` to support `'close_session'` and `'update_guest_count'`.
  - Enables offline queuing and chronological retry dispatch with deterministic client request IDs.
- **Captain / Staff Interactive Session Controls (`ActiveSessionModal.tsx`, `CaptainPage.tsx`)**:
  - Added interactive guest count adjustment controls with immediate validation against physical table capacity.
  - Multi-device realtime subscription updates reflected seamlessly across POS, Captain, and KDS without manual refresh.
- **Verification & Testing**:
  - Comprehensive unit and integration suite created in `src/test/phase4eTableSessionOps.test.ts` (13 tests passing).
  - Complete repository test suite passed: **36/36 test files, 365/365 individual tests passed**.

## [Milestone 4 — Phase 4D] - 2026-09-08 — Captain / Staff Operations Foundation

### Added & Verified
- **Captain / Staff Operational Screen (`src/pages/CaptainPage.tsx`)**:
  - Implemented floor operational interface for dining floor staff and captains to monitor table sessions, guest counts, active orders, and live KOT preparation progress.
  - Reuses existing `tableService`, `tableSessionService`, `orderService`, and `kotService` real-time subscriptions without duplicating domain logic or financial calculations.
- **Captain Navigation & Role Taxonomy**:
  - Added `captain` to `StaffRole` taxonomy (`src/types/auth.ts`) alongside `owner`, `manager`, `cashier`, and `kitchen`.
  - Added Captain / Staff Ops item to main navigation in `Sidebar.tsx` and route handling in `App.tsx`.
- **Interactive Floor Cards & Status Modals**:
  - **`TableCard.tsx`**: Displays floor area, capacity, occupancy badge, active session duration, order items count, and latest KOT kitchen status.
  - **`OpenSessionModal.tsx`**: Touch-friendly modal for opening new table sessions with guest count validation (1 <= guestCount <= capacity) and atomic transaction enforcement.
  - **`ActiveSessionModal.tsx`**: Drawer/modal for viewing active table sessions, ordered items, KOT progress, sending KOTs to kitchen, closing sessions, and linking to POS settlement.
- **Strict Boundary & Multi-Tenant Enforcement**:
  - Multi-tenant isolation enforced under `/restaurants/{restaurantId}/...`.
  - Financial calculations and payment settlement remain authoritatively handled by POS Terminal and Phase 2B/2C calculation engines.
- **Verification & Testing**:
  - Test suite created in `src/test/phase4dCaptainStaffOps.test.ts` verifying real-time subscriptions, atomic session locks, idempotency key generation, and role boundaries.
  - Full test suite passing: 35/35 test files passed (352/352 individual tests passed).

## [Milestone 4 — Phase 4A] - 2026-09-08 — Kitchen Display Foundation (KDS)

### Added & Verified
- **Kitchen Display System Route & Shell (`KitchenPage.tsx`)**:
  - Implemented high-contrast, dark-mode-optimized Kitchen Display System route accessible via `/kitchen` / Sidebar navigation.
  - Reuses existing `kotService.subscribeToKitchenKOTs` for real-time Firestore subscription to active non-terminal KOTs (`confirmed`, `sentToKitchen`, `preparing`, `ready`).
- **Realtime KOT Queue Cards (`KotCard.tsx`)**:
  - Displays ticket identity (`kotNumber`, `orderNumber`), order type badges (`Dine-In`, `Takeaway`, `Delivery`), and physical table identification (`Table X`).
  - Live elapsed preparation timer with visual urgency threshold badges (<10m slate/green, 10–20m amber warning, >20m red overdue alert).
  - High-readability KOT items list displaying quantity badges (`3x`), item short names, item notes, ticket notes, and modifier options.
- **KOT Lifecycle Status Controls**:
  - Authoritative status transition controls (`sentToKitchen` → `preparing` → `ready` → `served`) invoking `kotService.updateKOTStatus`.
  - KOT cancellation modal (`CancelKotModal.tsx`) enforcing mandatory audit reason logging via `kotService.cancelKOT`.
- **Operational UX States**:
  - High-contrast animated skeleton loading grid during initial connection.
  - Dedicated empty state ("Kitchen Queue Clear") when no active tickets remain.
  - Connection error banner with interactive **Retry Connection** button.
  - Embedded `OfflineSyncIndicator` in the header for connectivity and sync queue visibility.
- **Verification & Testing**:
  - Unit/integration test suite created in `src/test/phase4aKitchenDisplay.test.ts` verifying subscription filters, state machine transitions, cancellation validation, and multi-tenant isolation.
  - 33/33 test files passing (329/329 tests passing).

## [Milestone 3] - 2026-09-08 — Full POS Terminal Implementation

### Added & Verified
- **POS Terminal Shell & Layout**:
  - Top navigation bar with multi-tenant restaurant info, user role badge, order type selector, and offline queue indicator.
  - Category bar with horizontal scroll, active filters, and real-time menu item search.
  - Menu grid displaying availability badges, pricing, and category filters.
- **Cart & Order Management**:
  - Dynamic cart panel supporting item quantity updates, per-item custom notes, percentage/flat discounts, and order notes.
  - Integration with Phase 2B authoritative calculation engine (`calculateOrderTotals`) for zero-drift subtotal, tax, discount, and grand total in paise (minor units).
  - Support for Dine-In, Takeaway, and Delivery order types.
  - Table and TableSession integration requiring active session validation for Dine-In orders.
  - Historical price, name, and tax snapshots preserved on every order item.
- **Kitchen Order Tickets (KOT)**:
  - Atomic KOT creation via `kotService.createKOTFromOrder` with thermal short-name snapshots and status routing (`sentToKitchen`).
- **Payments & Settlement**:
  - Payment Modal supporting Cash, UPI, Card, and split payments.
  - Integration with `paymentService.recordPayment` enforcing overpayment prevention, exact balance updates, and transaction atomicity.
  - Printable / downloadable Bill Receipt Modal with QR code and breakdown.
- **Hold & Resume Carts**:
  - Held orders modal allowing staff to stash draft carts locally without creating uncommitted database records, with full resume and delete capabilities.
- **Cancellation & Refunds**:
  - Safe lifecycle order cancellation with mandatory reason logging via `orderService.updateOrderStatus`.
  - Authoritative payment refund mechanism via `paymentService.refundPayment` preserving historical records for financial auditing while updating active paid totals.
- **Offline Synchronization & Idempotency**:
  - Integration with `OfflineSyncService` for offline queuing, real-time status indicators, capacity limits, and exponential backoff retry.
  - Idempotency key binding across order creation, KOT creation, and payment settlement preventing duplicate operations during network re-connects.
- **Security & Multi-Tenant Isolation**:
  - Explicit `restaurantId` scoping across all POS actions, fully decoupled from `auth.uid`.
  - Strict compliance with Firestore security rules and multi-tenant domain boundaries.
- **Verification & Testing**:
  - Full regression test suite passing 32/32 test files (324/324 tests).
