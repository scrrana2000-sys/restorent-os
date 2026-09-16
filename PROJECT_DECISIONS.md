# Project Architectural & Business Decisions — RestaurantOS

## Milestone 3 Architectural Decisions

### 1. Existing Phase 2 Service Reuse
- **Decision**: The POS Terminal utilizes existing Phase 2 domain services (`OrderService`, `KOTService`, `PaymentService`, `TableSessionService`, `OfflineSyncService`) rather than duplicating business logic inside React components.
- **Rationale**: Ensures a single source of truth for financial rules, state transitions, security scoping, and data contracts.

### 2. Authoritative Financial Engine
- **Decision**: All financial calculations (subtotals, CGST/SGST/IGST taxes, percentage/flat discounts, grand totals) are computed authoritatively by `calculateOrderTotals` in minor integer units (paise).
- **Rationale**: Completely eliminates floating-point rounding errors and client-side financial manipulation.

### 3. Historical Price & Tax Snapshots
- **Decision**: Item names, short names, unit prices, and tax rates are snapshotted on `OrderItem` at the time of cart submission.
- **Rationale**: Protects historical orders and financial reporting from subsequent menu price or tax configuration edits.

### 4. Minor Unit Settlement & Overpayment Protection
- **Decision**: Payments are recorded in integer paise. `PaymentService.recordPayment` rejects any payment that would cause `paidAmountMinor > grandTotalMinor`.
- **Rationale**: Guarantees accounting integrity and prevents accidental double-charging or over-settlement.

### 5. Offline Synchronization & Payment Gateway Safeguards
- **Decision**: Offline operations are queued via `OfflineSyncService` with deterministic idempotency keys and processed chronologically upon network recovery.
- **Safeguard**: External digital payments (Card/UPI) cannot be marked as "completed" while offline without online payment gateway authorization.

### 6. Idempotency Key Binding
- **Decision**: Retry-sensitive operations (`create_order`, `create_kot`, `record_payment`) accept a `clientRequestId` / `idempotencyKey`.
- **Rationale**: Prevents duplicate database records or multiple kitchen print runs during network retries or client reconnection loops.

### 7. Identity Decoupling
- **Decision**: `auth.uid` is treated strictly as an actor identity and is NEVER assumed to equal `restaurantId`. All operations explicitly require and validate `restaurantId`.
- **Rationale**: Essential for multi-tenant isolation, staff access roles, and audit trail fidelity.

### 8. Held Orders Local Draft Isolation
- **Decision**: Held cart drafts are maintained in local state/storage and do NOT create uncommitted order documents in Firestore.
- **Rationale**: Prevents database clutter and corrupt financial metrics from abandoned or draft carts.

### 9. Immutable Financial Audit Trail for Refunds
- **Decision**: Payment documents are never deleted upon refund. `refundPayment` transitions the payment status to `refunded` and updates the order's `paidAmountMinor` and `dueAmountMinor`.
- **Rationale**: Preserves complete historical audit trail for financial accounting and reporting.

---

## Milestone 5 Architectural Decisions

### 10. Auth UID and Restaurant ID Decoupling
- **Decision**: `auth.uid` is strictly an actor/user identity and is NEVER conflated with `restaurantId`.
- **Rationale**: Preserves multi-tenant isolation, supports multi-outlet operators, and allows staff members to belong to different restaurants with distinct roles.

### 11. Strict Subcollection Partitioning & Cross-Tenant Isolation
- **Decision**: All business entities (categories, items, tables, tableSessions, orders, kots, payments, auditLogs, members) are strictly partitioned under `/restaurants/{restaurantId}/...`.
- **Rationale**: Guarantees zero data leakage across different restaurant outlets, enforces deterministic security boundaries in `firestore.rules`, and simplifies tenant maintenance.

### 12. Client Storage Is NOT an Authorization Mechanism
- **Decision**: `localStorage` (e.g., cached `restaurantId` or UI preferences) is strictly treated as a non-authoritative client cache.
- **Rationale**: Any cached outlet identifier is always re-verified against the user's active membership or ownership in Firestore. Forged or stale storage keys are automatically evicted upon discovery failure.

### 13. Absolute Immutability of Audit Logs
- **Decision**: Audit log documents (`/restaurants/{restaurantId}/auditLogs/{logId}`) are strictly write-once and append-only.
- **Rationale**: `firestore.rules` enforces `allow update, delete: if false`. Clients are strictly forbidden from modifying or erasing historical audit records, ensuring tamper-evident accountability.

### 14. Architecture Reuse for Analytics & Audit Operations
- **Decision**: Milestone 5 reporting and audit systems reuse existing transactional models (`Order`, `Payment`, `AuditLog`) and offline synchronization architecture (`OfflineSyncService`, `idempotencyService`) rather than introducing duplicate database collections or divergent schemas.
- **Rationale**: Ensures single source of truth for financial numbers, avoids synchronization drift, and keeps data models lean.

### 15. Prohibition of Speculative Hierarchies (Organizations / Branches)
- **Decision**: Maintained the canonical flat restaurant tenant model (`/restaurants/{restaurantId}`) rather than introducing speculative multi-tier schemas (such as `organizations/{organizationId}/branches/{branchId}`).
- **Rationale**: Respects strict scope boundaries, satisfies all multi-outlet discovery and switching requirements via existing ownership and membership models, and avoids unnecessary structural complexity.

---

## Milestone 6 Architectural Decisions

### 16. Three-Layer Role & Permission Defense
- **Decision**: Operational security for all 6 roles (`owner`, `manager`, `cashier`, `captain`, `kitchen`, `accountant`) is enforced at three distinct layers:
  1. **UI Layer (`isViewAllowed`)**: Conditionally renders navigation links and view containers, providing clear role-specific UI and fast client redirection for unauthorized navigation attempts.
  2. **Service / Business-Logic Layer (`enforcePermission`)**: Gating functions inside domain services (`orderService`, `paymentService`, `kotService`, `menuService`, `tableSessionService`, `tableService`, `auditService`) that check active restaurant membership and role prior to performing mutations or fetching restricted data.
  3. **Backend / Security Rules Layer (`firestore.rules`)**: Server-enforced, tamper-proof security rules that reject direct document create, read, update, or delete attempts from unauthenticated, inactive, or unauthorized roles regardless of client state.
- **Rationale**: UI hiding alone is never authorization. Service-level checks ensure safe client execution and provide readable errors, while Firestore security rules guarantee data safety against malicious or direct API tampering.

### 17. Role-Specific Read and Write Isolation
- **Decision**:
  - `payments` read access is restricted to `owner`, `manager`, `cashier`, and `accountant`, preventing unauthorized financial visibility on Kitchen or Captain devices.
  - `auditLogs` read access is restricted to `owner`, `manager`, and `accountant`, with client update and delete permanently blocked (`allow update, delete: if false`).
  - Order cancellation is restricted strictly to `owner` and `manager`, preventing unauthorized cashier or captain cancellations without manager escalation.
  - Category, menu item, and physical table definitions are restricted strictly to `owner` and `manager`.
- **Rationale**: Enforces least-privilege security principle across staff roles while preserving smooth operational workflows for high-frequency kitchen and captain operations.

### 18. Staff Invitation and Identity Decoupling
- **Decision**: Adding a staff member creates a pending invitation record (`status: 'pending_setup'`, `isActive: false`) with a single-use cryptographically secure invitation token, rather than creating or overwriting Firebase Auth users directly from the owner's session.
- **Rationale**: Prevents session hijacking, eliminates plaintext password handling, and preserves identity sovereignty: employees own their Firebase Auth credentials and claim their role assignment via authenticated invitation acceptance (`/accept-invitation`).

### 19. Authoritative Server-Side Dispatch Boundary & Audit Redaction
- **Decision**: All invitation email dispatch requests via `/api/send-invitation-email` must authenticate using Firebase Auth `Bearer` ID tokens. The backend resolves `restaurantName` and staff `role` directly from authoritative Firestore documents, ignoring client-supplied metadata. In addition, raw invitation tokens are never written to audit logs; only truncated SHA-256 fingerprints are logged.
- **Rationale**: Eliminates phishing vectors where attackers pass forged restaurant names or spoofed roles to external recipients, prevents privilege escalation, and ensures audit trails remain secure and tamper-evident.

---

## Phase 4.5 & Phase 4.6 Architectural Decisions

### 20. Payment Due Collection Center Architecture
- **Decision**: The POS features a dedicated Payment Due Collection Center (`PaymentDueCenterModal.tsx`) that aggregates all open/unsettled orders (`dueAmountMinor > 0`) across both Dine-In and Takeaway/Parcel fulfillment types. Realtime subscriptions remove orders from the Payment Due view immediately when `dueAmountMinor === 0`.
- **Rationale**: Provides cashiers and managers with immediate operational visibility over outstanding receivables while keeping Payment History (recorded tenders) and Orders History (finalized documents) conceptually separated.

### 21. User-Facing Table Label Resolution & ID Masking
- **Decision**: Dine-In cards, receipts, and modal views must resolve human-readable table identifiers (`Table 1`, `Table 5 (Patio VIP)`) using tenant table lookup maps. Raw document IDs (e.g. `LUBEOOUHBP7RL8HMZV0H`), internal session IDs, and transaction UUIDs are strictly masked from user-facing screens.
- **Rationale**: Prevents confusion on busy restaurant floors, enhances operational readability, and protects internal system identifiers from external exposure.

### 22. Active Table Order Merge & KOT Cancellation Grace Rule
- **Decision**: Adding menu items to an active Dine-In table session appends items to the existing open order rather than creating fragmented duplicate orders. In addition, order cancellation from POS within 2 minutes automatically cancels waiting KOTs (`sentToKitchen`/`confirmed`), whereas cancellation after 2 minutes is blocked from POS and must be initiated from the Kitchen Display (KDS).
- **Rationale**: Ensures accurate single-bill table invoicing and prevents kitchen food wastage if order preparation has already commenced.

---

## Milestone 9 Architectural Decisions: Customer App & Online Ordering

### 23. Customer Account & Profile Foundation (Milestone 9 — Phase 1)
- **Decision**:
  1. **Google Sign-In as Sole Authentication Provider**: Customer account authentication uses Google Sign-In (`signInWithPopup(auth, googleProvider)`). No other auth providers (email/password, social media, anonymous) are used for customer accounts.
  2. **Strict Customer ID Contract**: `customerId` is deterministically bound to the Firebase Auth UID (`auth.currentUser.uid`). Profile documents are stored at `/customers/{customerId}`.
  3. **Strict Decoupling from Restaurant Staff/Tenant Identity**: Customer authentication is isolated via `CustomerAuthContext` and `customerAuthService`, independent of `AuthContext` (which manages restaurant owner and employee memberships). A customer profile grants no administrative, POS, or staff permissions.
  4. **Strict Isolation in Firestore Security Rules**:
     - Rules enforce `allow read, write: if request.auth != null && request.auth.uid == customerId;` on `/customers/{customerId}`.
     - Customer A cannot read or write Customer B's profile under any circumstances.
     - Unauthenticated users cannot read or write customer documents.
     - Restaurant staff and owners have no direct access to customer profile documents.
  5. **Explicit Prohibition of Phone OTP / SMS Auth**:
     - Phone OTP, SMS delivery services, phone verification screens, and reCAPTCHA verifiers are strictly prohibited and intentionally omitted.
     - Phone numbers are stored purely as user-supplied string fields for delivery contact and order coordination, not as authentication credentials.
  6. **Guest Checkout Preservation**:
     - Guest checkout remains completely functional without requiring Google Sign-In or profile creation.
     - When a customer is signed in, their name, phone, and delivery address are automatically pre-filled, with an option to sign in directly from the checkout modal.
  7. **Preservation of Core Systems**:
     - Zero modifications or rewrites to `OrderService`, KDS, POS, or table management.
### 24. Customer ↔ Order Linking & Snapshot Immutability (Milestone 9 — Phase 2)
- **Decision**:
  1. **Order Customer ID Contract**:
     - The `Order` domain model optionally contains `customerId?: string | null`.
     - When an authenticated customer places an order, `customerId` is strictly set to the customer's Firebase UID (`auth.currentUser.uid`).
     - When a guest places an order, `customerId` is `null` or omitted.
  2. **Authoritative Anti-Spoofing Enforcement**:
     - All online order submissions flow through `/api/submit-online-order` or direct validation where the authenticated ID token is decoded on the server.
     - If `customerId` is provided, it must strictly match the verified `decoded.uid`. Any spoofing attempt (e.g. User A requesting `customerId` of User B) is authoritatively rejected with HTTP 403 / Security Violation.
  3. **Snapshot Immutability vs Profile Decoupling**:
     - `order.customerSnapshot` captures the point-in-time contact and delivery details (name, phone, email, delivery address).
     - The customer profile at `/customers/{customerId}` is NOT overwritten by subsequent orders, nor does updating a profile alter historical order records. This guarantees accounting and legal audit immutability.
  4. **Firestore Security Rules for Orders**:
     - Security rules on `/orders/{orderId}` allow reads if:
       - The authenticated customer owns the order (`resource.data.customerId == request.auth.uid`), OR
       - The order is an online order (`resource.data.source == 'online'`), allowing guest order status lookup, OR
       - The user is an authorized staff member or admin of the restaurant.
     - Broad public reads (`allow read: if true;`) remain strictly prohibited.
  5. **Core POS & KDS Integrity**:
     - `OrderService`, KOT generation, KDS display, and payment lifecycle operate seamlessly without architectural restructuring.
- **Rationale**: Guarantees secure, cryptographic identity binding between customer accounts and order histories while preserving guest checkout, preventing identity impersonation attacks, and protecting historical audit trails.

### 25. Realtime Online Order Notification & Deduplication Architecture (Milestone 9 — Phase 3)
- **Decision**:
  1. **Zero Secondary Order Database / Single Source of Truth**:
     - Restaurant staff notifications react exclusively to successfully created orders in Firestore under `/restaurants/{restaurantId}/orders`. No secondary notification table, webhook dispatcher, or duplicated order repository is created.
  2. **Initial Snapshot & Reconnect Deduplication Engine**:
     - On initial snapshot load, all existing orders are indexed into an in-memory `seenOrderIds` Set without triggering audio or visual alerts.
     - Only subsequent document creations where `change.type === 'added'` and `order.source === 'online'` trigger alerts.
     - Reconnect events re-use the persistent `seenOrderIds` cache to prevent re-announcing historical orders upon offline-to-online transitions.
  3. **Local Notification State vs Order Lifecycle**:
     - Notification state (pending, dismissed, viewed) is purely client-side React UI state.
     - Acknowledging or dismissing a notification NEVER mutates `order.status` or writes to Firestore.
  4. **Native Audio Synthesis with Graceful Degradation**:
     - Uses native Web Audio API oscillators to generate a short two-tone chime without external asset loading.
     - Gracefully catches browser autoplay policy rejections without throwing unhandled exceptions or suppressing visual notifications.
  5. **Staff Tenant Isolation**:
     - Notification subscriptions are strictly partitioned by `restaurantId`. Staff for Restaurant A cannot observe or receive order alerts for Restaurant B.
- **Rationale**: Ensures operational awareness for KDS and POS staff when customers place online orders, while eliminating notification spam, preventing duplicate alerts across reconnects, preserving strict tenant boundaries, and protecting the order lifecycle from unintended status side-effects.

### 26. Customer Order Tracking Architecture & Read-Only Observation (Milestone 9 — Phase 4)
- **Decision**:
  1. **Read-Only / Pure Observation Discipline**:
     - Customer tracking operates strictly as a read and subscription layer on `/restaurants/{restaurantId}/orders/{orderId}`.
     - Customer tracking NEVER writes unauthorized mutations to Firestore or creates a duplicate order collection. Status progression is strictly managed by authorized restaurant staff via POS, KDS, and Kitchen operations.
  2. **Single Authoritative Lifecycle Mapping**:
     - The customer tracking timeline translates existing backend `OrderStatus` values (`draft`, `confirmed`, `sentToKitchen`, `preparing`, `ready`, `served`, `completed`, `cancelled`) into 4 customer-friendly progress stages (Order Placed → Preparing in Kitchen → Ready/Out for Delivery → Completed) with cancelled state handling.
  3. **Guest Checkout Preservation via Local Storage References**:
     - For guest checkouts, an authorized tracking reference (`TrackedOrderReference`) is persisted to `localStorage` (`restaurantos_guest_tracked_orders`) upon order submission.
     - For authenticated customers, references are stored under `restaurantos_customer_tracked_orders_{uid}`.
     - Both guest and authenticated customers can re-open active orders from the top navigation bar ("Orders" button with dynamic count badge).
  4. **Data Sanitization & Customer Privacy**:
     - Internal kitchen and cashier metadata (such as internal cost margins and private server notes) are scrubbed via `sanitizeCustomerOrder` before rendering to customer views.
  5. **No Phone OTP**:
     - No SMS gateway, phone OTP, or phone authentication was introduced. Order tracking identity relies on Firebase Auth UID and client-side access tokens.
  6. **CRM / Phase 5 Isolation**:
     - Restaurant customer management, loyalty programs, marketing campaigns, and CRM metrics remain strictly out of scope for Phase 4.

### 27. Online Order Queue, Prep Time Presets & Inventory Reversion Architecture (Milestone 9 — Phase 4)
- **Decision**:
  1. **Direct Queue Integration in Orders & POS**:
     - Online orders seamlessly route into the unified restaurant order queue with tabbed filtration (`all`, `pending_action`, `in_kitchen`, `ready_handover`, `online_history`).
  2. **Preparation Time Presets & Custom Input**:
     - Order acceptance prompts staff with 5 preset preparation buttons (`15m`, `20m`, `30m`, `45m`, `60m`) or a custom minute input.
     - Sets `estimatedPrepMinutes`, `acceptedAt`, and `estimatedReadyAt` on the order and automatically updates customer-facing tracking timeline and countdown.
  3. **Order Rejection & Stock Reversion**:
     - Rejection requires an explicit reason (preset or custom explanation) and sets `order.status = 'cancelled'`, `rejectionReason`, `rejectedAt`, and `cancelledBy`.
     - Automatically invokes inventory restoration for all line items to return reserved stock to available inventory.
     - Idempotent guards prevent double cancellation or rejection of already finalized/served orders.
  4. **Bill Printing & Sound Alerts**:
     - Online orders maintain full compatibility with thermal bill printing and optional sound alerts with user toggle persistence.
- **Rationale**: Delivers a transparent, real-time tracking experience for online diners while maintaining strict separation of concerns, protecting internal operational data, preserving guest checkout convenience, guaranteeing inventory balance integrity, and upholding zero-mutation safety across the core order state machine.


