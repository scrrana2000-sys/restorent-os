import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root,p),'utf8');
const rules = read('firestore.rules');
const pkg = JSON.parse(read('package.json'));
const workflow = read('.github/workflows/deploy.yml');
const checks = [
 ['no hardcoded default server password', !read('src/server/invitationAuth.ts').includes('SystemSecurePassword123!')],
 ['no production simulated payment path', !read('src/services/subscriptionPaymentService.ts').includes('simulatedOrderId') && read('src/services/subscriptionPaymentService.ts').includes('Mock payment provider is disabled outside test environments.')],
 ['subscription writes server-only', rules.includes("match /subscription/{subDocId}") && rules.includes('allow create, update: if isServer()')],
 ['subscription history immutable', rules.includes("match /subscriptionHistory/{historyId}") && rules.includes('allow update, delete: if false')],
 ['webhook event id required', read('server.ts').includes('MISSING_WEBHOOK_EVENT_ID')],
 ['production env requires explicit origin', read('server.ts').includes("'ALLOWED_ORIGINS'") && read('server.ts').includes("'PUBLIC_APP_URL'")],
 ['web pages deploy only dist', pkg.scripts?.['build:server']?.includes('dist-server/server.cjs') === true && workflow.includes('run: npm run build:web') && workflow.includes("path: './dist'")],
 ['order deletion limited to draft', rules.includes("resource.data.status == 'draft'")],
 ['payment actor bound to auth uid', rules.includes('request.resource.data.createdBy == request.auth.uid')],
 ['idempotency is actor-bound', rules.includes('resource.data.createdBy == request.auth.uid')],
 ['checkout modifier matching is ID-only', !read('src/services/customerCheckoutService.ts').includes('a.name === clientAddon.name')],
 ['subscription entitlement fails closed', !read('src/services/subscriptionService.ts').includes("paymentStatus: 'paid',\n      provider: 'mock_gateway'") && read('src/services/subscriptionService.ts').includes('evaluateSubscriptionEntitlements(null)')],
 ['stock consumption uses trusted server endpoint in browser', read('src/services/stockConsumptionService.ts').includes("/api/stock/consume-order")],
 ['stock ledger writes are server-only', rules.includes("match /stockMovements/{movementId}") && rules.includes("allow create: if isServer()") && rules.includes("match /stockConsumptions/{consumptionId}")],
 ['print jobs bind to creator', read('src/services/printer/PrinterService.ts').includes("createdBy: auth.currentUser?.uid || 'system'")],
 ['pages API URL is the trusted production HTTPS endpoint', read('.github/workflows/deploy.yml').includes('VITE_API_BASE_URL: https://restaurantos-xqi52dpwgo-as.a.run.app')],
 ['cloud run deploy waits for verify', read('.github/workflows/deploy-cloud-run.yml').includes('needs: verify')]
];

const serverSource = read('server.ts');
const dockerfile = read('Dockerfile');
const dockerignore = read('.dockerignore');
const cloudRunWorkflow = read('.github/workflows/deploy-cloud-run.yml');
const releaseWorkflow = read('.github/workflows/deploy.yml');

checks.push(
  ['production public URL requires HTTPS origin validation', serverSource.includes('PUBLIC_APP_URL must be an HTTPS origin URL')],
  ['production CORS origins require HTTPS exact origins', serverSource.includes('ALLOWED_ORIGINS must contain exact HTTPS origins only')],
  ['production startup blocks until trusted server auth succeeds', serverSource.includes('Fatal: trusted server authentication failed') && /await ensureServerAuthenticated\(\)/.test(serverSource)],
  ['production container runs as non-root node user', dockerfile.includes('USER node')],
  ['docker build excludes environment secret files', dockerignore.includes('.env') && dockerignore.includes('.env.*')],
  ['Cloud Run workflow runs release verification before deploy', cloudRunWorkflow.includes('needs: verify') && cloudRunWorkflow.includes('npm run verify')],
  ['Pages workflow receives explicit public production endpoints', releaseWorkflow.includes('VITE_API_BASE_URL: https://restaurantos-xqi52dpwgo-as.a.run.app') && releaseWorkflow.includes('VITE_PUBLIC_APP_URL: https://restaurantos01.ai.studio')],
  ['server-side permission helper recognizes only the dedicated server account', read('src/utils/permissions.ts').includes("user.email === 'system-server@restaurantos.app'" )],
  ['user profile role is not client-writable', rules.includes("match /users/{userId}") && rules.includes("role fields are never") && !/updateDoc\(userRef,[\s\S]{0,220}?role\s*:\s*newRole/.test(read('src/services/staffService.ts'))],
  ['public bill uses tokenized API access', serverSource.includes('/api/orders/public-bill') && serverSource.includes('BILL_FORBIDDEN') && serverSource.includes('customerTrackingToken !== accessToken')],
  ['guest tracking uses high-entropy token', serverSource.includes("randomBytes(32).toString('base64url')")],
  ['Dockerfile does not copy environment secret files', dockerignore.includes('.env') && dockerignore.includes('.env.*')],
  ['POS financial order creation uses trusted API boundary', serverSource.includes('/api/orders/create-pos') && read('src/services/orderService.ts').includes('/api/orders/create-pos')],
  ['idempotency records are private to creator/server', rules.includes('isServer() || (isSignedIn() && resource.data.createdBy == request.auth.uid)')],
  ['order creation is server-authoritative', /match \/orders\/\{orderId\}[\s\S]*?allow create: if isServer\(\)/.test(rules)],
  ['KOT creation is server-authoritative', /match \/kots\/\{kotId\}[\s\S]*?allow create: if isServer\(\)/.test(rules)],
  ['order stock locks are server-only mutations', /match \/order_stock_locks\/\{lockId\}[\s\S]*?allow update: if isServer\(\)/.test(rules)],
  ['POS order API validates source and order type enums', serverSource.includes("new Set(['pos', 'captain', 'admin', 'api'])") && serverSource.includes("new Set(['dineIn', 'takeaway', 'delivery'])")],
  ['KOT browser creation uses trusted API boundary', read('src/services/kotService.ts').includes("/api/kots/create") && serverSource.includes("app.post('/api/kots/create'")],
  ['order API never creates shared idempotency key when caller omitted request ID', serverSource.includes("return rawClientRequestId ? `${authUser.uid}_${rawClientRequestId}` : undefined") ],
  ['webhook failed events are retryable', read('src/server/razorpayService.ts').includes("existingStatus === 'failed' || isStaleProcessing") && read('src/server/razorpayService.ts').includes("processingLeaseMs = 10 * 60 * 1000")],
  ['restaurant document deletion is disabled to avoid orphaned tenant data', rules.includes('allow delete: if false;') && /match \/restaurants\/\{restaurantId\}[\s\S]*?allow delete: if false;/.test(rules)],
);
let failed=0;
for (const [name,ok] of checks) { console.log(`${ok?'PASS':'FAIL'}: ${name}`); if(!ok) failed++; }
if(failed) process.exit(1);
