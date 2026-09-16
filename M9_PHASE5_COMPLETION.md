# Milestone 9 Phase 5 — Restaurant Customer Management / CRM Foundation

## Overview
Milestone 9 Phase 5 delivers the restaurant-scoped Customer Management and CRM foundation for RestaurantOS. It provides restaurant owners, managers, and staff with deep visibility into their customer directory, order history, and operational metrics while enforcing strict multi-tenant data isolation, zero-auto-merging, and customer privacy boundaries.

---

## Architecture & Invariants

### 1. Data Source of Truth & Tenant Scoping
- **Orders Subcollection**: Customer activity is aggregated strictly from orders placed at the current restaurant (`/restaurants/{restaurantId}/orders`).
- **Global Profile Protection**: The root `/customers/{customerId}` collection remains strictly owned and managed by the authenticated customer. Restaurant staff cannot mutate or corrupt global customer profiles.
- **Tenant Isolation**: Restaurant A queries only `/restaurants/{restaurantId}/orders` and never receives customer records or order history from Restaurant B.

### 2. Identity & Deduplication Rules
- **Registered Customers**: Authenticated customer orders containing a valid `customerId` (Firebase Auth UID) are deduplicated into a single customer profile entry. Multi-order metrics (order count, total spend, AOV, first/last order date) are aggregated across all orders placed by that user at this restaurant.
- **Guest Orders**: Orders placed without an authenticated account (`customerId: null`) are maintained as distinct guest activity records without fabricating fake customer UIDs or performing speculative fuzzy merging.
- **No Automatic Merging**: Guest orders sharing the same name or phone number as a registered customer are never merged automatically.

### 3. Staff RBAC Permissions
- **Allowed Roles**: `owner`, `manager`, and `cashier` have explicit permission (`access_customers` / `view_customers`) to view the Customers & CRM console.
- **Restricted Roles**: `kitchen`, `captain`, and `accountant` are blocked from accessing the customers view.
- **Operating Modes**: `isCustomersVisible` is enabled across all restaurant operating profiles.

---

## Key Features Implemented

1. **Customers & CRM Navigation**:
   - Integrated into the restaurant admin `Sidebar.tsx` with icon `UserCheck`.
   - Accessible via view `'customers'`.

2. **Executive Metrics Overview**:
   - **Unique Customers**: Total count with registered vs. guest breakdown.
   - **Total Customer Orders**: Count of all orders placed at this restaurant.
   - **Total Customer Spend**: Net revenue from valid (non-cancelled) orders.
   - **Average Order Value (AOV)**: Average spend per customer order.

3. **Fast Search & Operational Filters**:
   - Search by customer name, email, phone number, or customer UID.
   - Category filters: All Customers, Registered Accounts, Guest Activity, 2+ Orders (Frequent), and Last 30 Days (Recent).

4. **Interactive Customer Directory**:
   - Customer avatar initial with Registered / Guest identity badge.
   - Contact details (Email, Phone) from order snapshots.
   - Total order count and spend breakdown.
   - Last order date and type (Takeaway, Delivery, Dine-In).
   - "View Details" action.

5. **Customer Detail Modal**:
   - Complete contact and identity breakdown.
   - Operational KPIs (Total orders, completed, cancelled, total spend, AOV, first/last order dates).
   - Full restaurant-scoped order history list with order numbers, items, status badges, and timestamps.
   - "View Order" shortcut button to jump directly into the Orders view.

---

## Verification
- Unit test suite: `src/test/milestone9Phase5RestaurantCustomerManagement.test.tsx` (13/13 tests passing).
- Multi-tenant isolation verified: Restaurant A queries return only Restaurant A customers; Restaurant B customers are strictly excluded.
- Anti-regression verified: No phone OTP, no SMS, no loyalty marketing, no AI customer scoring, and no unauthorized collection mutations.
