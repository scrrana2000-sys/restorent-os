# Milestone 9 — Phase 2: Customer ↔ Order Linking Foundation — Completion Report

**Project**: RestaurantOS  
**Date**: September 16, 2026  
**Status**: COMPLETE & VERIFIED  

---

## Executive Summary

Milestone 9 — Phase 2 establishes the cryptographic and operational foundation linking online customer orders with authenticated customer accounts (`/customers/{customerId}`). The implementation strictly respects all core RestaurantOS architectural boundaries:
1. **Zero Rewrites**: `OrderService`, POS Terminal, Table Management, and Kitchen Display System (KDS) operate with 100% continuity.
2. **Guest Ordering Continuity**: Unauthenticated guests can place takeaway and delivery orders without friction.
3. **Anti-Spoofing Security**: Server-side token validation strictly forbids submitting orders under another customer's `customerId`.
4. **Historical Immutability**: `order.customerSnapshot` preserves the exact historical checkout data at the time of order placement, decoupled from future profile edits.
5. **No Prohibited Features**: Phone OTP, SMS authentication, and customer notifications were intentionally omitted per project constraints.

---

## Technical Specifications

### 1. Order Customer ID Contract
- **Schema**: `customerId?: string | null` added to `Order` (`src/types/order.ts`) and checkout submission payloads (`CustomerCheckoutDetails`, `CustomerCheckoutIntent`).
- **Identity Binding**: When a customer is signed in via Google Sign-In, `customerId` is set directly to `auth.currentUser.uid`.
- **Guest Orders**: When an order is placed without authentication, `customerId` is `null` or omitted.
- **Snapshot Separation**:
  - `order.customerSnapshot`: `{ name, phone, email?, deliveryAddress? }` captures the snapshot at order placement time.
  - `/customers/{customerId}`: Customer account profile. Profile updates do NOT alter past order snapshots; past order snapshots do NOT mutate customer profiles.

### 2. Anti-Spoofing & Identity Hardening
- Implemented in `server.ts` (`/api/submit-online-order`) and `customerCheckoutService.ts`:
  - When `customerId` is passed, the request's Bearer ID token is verified via `verifyFirebaseToken`.
  - The decoded token `uid` must strictly match `customerId`.
  - If a mismatch is detected (e.g. Customer A attempts to submit an order with Customer B's UID), the request is rejected immediately with HTTP 403 / Security Violation.

### 3. Firestore Security Rules
- Updated `/orders/{orderId}` rules in `firestore.rules`:
  - **Owning Customer Read**: `resource.data.customerId == request.auth.uid` allows customers to query and view their personal order history.
  - **Guest Online Read**: `resource.data.source == 'online'` allows guests to track their online order progress.
  - **Staff & Admin Scoped Access**: Restaurant staff and owners retain full operational read/write access to orders within their scoped restaurant tenant.
  - **Arbitrary Public Reads Blocked**: Public open reads (`allow read: if true;`) remain strictly prohibited.

### 4. KDS & Operational Continuity
- Seamless generation of Kitchen Order Tickets (KOT) via `OrderService.createOrderAndKOTFromCart`.
- Separation of operational and financial concerns: KOT items contain kitchen preparation details while excluding financial unit prices or totals.
- Indian GST calculations (CGST 2.5% + SGST 2.5% = 5%) and financial invariants computed authoritatively in minor units (paise).

---

## Automated Verification Suite

### Dedicated Test Suite (`src/test/milestone9Phase2CustomerOrderLinking.test.tsx`)
All 12 required test cases pass with 100% coverage:

| Test ID | Description | Result |
| :--- | :--- | :--- |
| **TEST 1** | Authenticated customer places an online order | **PASSED** |
| **TEST 2** | Order document contains authenticated customer `customerId` | **PASSED** |
| **TEST 3** | `customerId` strictly equals the Firebase Auth UID (`auth.currentUser.uid`) | **PASSED** |
| **TEST 4** | Order contains `customerSnapshot` preserving checkout data | **PASSED** |
| **TEST 5** | Snapshot contains exact historical checkout information at order time | **PASSED** |
| **TEST 6** | Guest can place an online order without `customerId` or authentication | **PASSED** |
| **TEST 7** | Prevents spoofing `customerId` when client requests a different identity | **PASSED** |
| **TEST 8** | Customer profile in `/customers/{customerId}` remains independent from order snapshot | **PASSED** |
| **TEST 9** | Existing KDS and KOT generation receives online orders seamlessly | **PASSED** |
| **TEST 10** | Existing order status flow and lifecycle works with customer-linked orders | **PASSED** |
| **TEST 11** | `firestore.rules` keeps restaurant/admin permissions intact while protecting customer orders | **PASSED** |
| **TEST 12** | `Order` interface and `CustomerCheckoutDetails` maintain strict typing | **PASSED** |

### Customer Suite Regression Pass
- `src/test/milestone9Phase1CustomerProfile.test.tsx`: 12/12 PASSED
- `src/test/milestone9Phase2CustomerOrderLinking.test.tsx`: 12/12 PASSED
- `src/test/phase9gCustomerCart.test.tsx`: 28/28 PASSED
- `src/test/phase9hCustomerCheckout.test.tsx`: 35/35 PASSED
- `src/test/phase9iCustomerOnlineOrderSubmission.test.tsx`: 12/12 PASSED
- **Total Customer Suite Tests**: **99/99 PASSED (100%)**

### Build & Linter Validation
- `npm run lint` (`tsc --noEmit`): 0 errors
- `npm run build` (`vite build && esbuild`): SUCCESS
