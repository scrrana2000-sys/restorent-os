import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const rules = read('firestore.rules');
const restaurant = read('src/services/restaurantService.ts');
const tableSession = read('src/services/tableSessionService.ts');
const staff = read('src/services/staffService.ts');
const kot = read('src/services/kotService.ts');
const purchase = read('src/services/purchaseOrderService.ts');
const server = read('server.ts');
const subscription = read('src/services/subscriptionService.ts');
const apiConfig = read('src/utils/apiConfig.ts');
const authService = read('src/services/authService.ts');

const checks = [
  ['initial user profile write includes userId and not forbidden role field', restaurant.includes('transaction.set(userRef, { userId, restaurantId: initDocId, initialRestaurantId: initDocId }') && !restaurant.includes("transaction.set(userRef, { restaurantId: initDocId, initialRestaurantId: initDocId, role: 'owner'" )],
  ['table session create mirrors Firestore document id', rules.includes('request.resource.data.id == sessionId') && tableSession.includes('transaction.set(newDocRef, { ...sessionData, id: newDocRef.id })')],
  ['cashier/captain table lifecycle update supports status changes', rules.includes("hasOnly(['activeSessionId', 'status', 'updatedAt'])")],
  ['table session guest-count update is permitted', rules.includes("hasOnly(['id', 'guestCount', 'updatedBy', 'updatedAt'])")],
  ['server idempotency writes are allowed but tenant-bound', /match \/idempotency\/\{key\}[\s\S]*?allow create: if \(\s*isServer\(\)/.test(rules)],
  ['KOT browser creation uses trusted API', kot.includes("/api/kots/create") && server.includes("app.post('/api/kots/create'")],
  ['purchase receiving browser path uses trusted API', purchase.includes("/api/purchases/receive") && server.includes("app.post('/api/purchases/receive'")],
  ['subscription browser fallback fails closed', subscription.includes('Subscription verification service is unavailable')],
  ['non-local browser API calls never default to the frontend origin', apiConfig.includes('PRODUCTION_API_BASE_URL') && apiConfig.includes('isLocal || isCloudRun ? window.location.origin : PRODUCTION_API_BASE_URL')],
  ['staff invitation can create a rules-compliant user profile', staff.includes('userId: user.uid') && staff.includes('createdAt: serverTimestamp()')],
  ['existing initial restaurant profile link can create a rules-compliant user doc', restaurant.includes('userId,') && restaurant.includes('initialRestaurantId: existing.restaurantId')],
  ['user restaurant-link helper can create a rules-compliant profile when missing', authService.includes('if (existing.exists())') && authService.includes('userId,') && authService.includes('initialRestaurantId: restaurantId')],
  ['server can read server-processed tenant collections through the dedicated identity', [
    /match \/orders\/\{orderId\}[^]*?allow read: if isServer\(\)/.test(rules),
    /match \/items\/\{itemId\}[^]*?allow read: if isServer\(\)/.test(rules),
    /match \/inventoryItems\/\{itemId\}[^]*?allow read: if isServer\(\)/.test(rules),
    /match \/recipes\/\{recipeId\}[^]*?allow read: if isServer\(\)/.test(rules),
    /match \/stockConsumptions\/\{consumptionId\}[^]*?allow read: if isServer\(\)/.test(rules),
    /match \/order_stock_locks\/\{lockId\}[^]*?allow read: if isServer\(\)/.test(rules),
  ].every(Boolean)],
  ['server purchase receiving writes are permitted but field-limited', /match \/purchaseOrders\/\{purchaseOrderId\}[^]*?isServer\(\)[^]*?hasOnly\(\['status', 'items', 'updatedAt', 'updatedBy'\]\)/.test(rules) && /match \/purchaseReceivings\/\{receivingId\}[^]*?isServer\(\)/.test(rules)],
  ['server-driven table-session closure is permitted but limited to lifecycle fields', /match \/tables\/\{tableId\}[^]*?isServer\(\)[^]*?hasOnly\(\['activeSessionId', 'status', 'updatedAt'\]\)/.test(rules)],
  ['cashier order updates preserve legal status transitions', /match \/orders\/\{orderId\}[^]*?match \/kots/.test(rules) && rules.includes("isAllowedOrderStatusTransition(resource.data.status, request.resource.data.status)" )],
];
let failed=0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
