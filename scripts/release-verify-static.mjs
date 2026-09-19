import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'firestore.rules', 'storage.rules', 'firebase.json', 'package.json', 'package-lock.json',
  'server.ts', 'Dockerfile', '.github/workflows/deploy.yml', '.github/workflows/deploy-cloud-run.yml',
  'scripts/security-audit.mjs', 'scripts/firestore-contract-audit.mjs'
];
const missing = required.filter((f) => !fs.existsSync(path.join(root, f)));
if (missing.length) {
  console.error('RELEASE_REQUIRED_FILES_MISSING', missing.join(','));
  process.exit(1);
}
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
const appFirebaseConfig = JSON.parse(fs.readFileSync(path.join(root, 'firebase-applet-config.json'), 'utf8'));
const appDbId = String(appFirebaseConfig.firestoreDatabaseId || '').trim();
const firestoreConfigs = Array.isArray(firebaseConfig.firestore) ? firebaseConfig.firestore : [];
const matchingFirestoreConfig = firestoreConfigs.find((cfg) => String(cfg?.database || '').trim() === appDbId);
if (!appDbId || !matchingFirestoreConfig || matchingFirestoreConfig.rules !== 'firestore.rules') {
  console.error('NAMED_FIRESTORE_DATABASE_BINDING_FAILED', { appDbId, firestoreConfigs });
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const script of ['verify','audit:security','audit:firestore-contract','lint','test','build']) {
  if (!pkg.scripts?.[script]) { console.error('RELEASE_SCRIPT_MISSING', script); process.exit(1); }
}
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const securityInvariants = [
  ['default deny', /match \/\{document=\*\*\}/s.test(rules) && /allow read, write: if false;/s.test(rules)],
  ['server-only subscription', /match \/subscription\/\{subDocId\}[\s\S]*?allow create, update: if isServer\(\)/.test(rules)],
  ['server-only order create', /match \/orders\/\{orderId\}[\s\S]*?allow create: if isServer\(\)/.test(rules)],
  ['server-only KOT create', /match \/kots\/\{kotId\}[\s\S]*?allow create: if isServer\(\)/.test(rules)],
  ['tenant invariants', /request\.resource\.data\.restaurantId == restaurantId/.test(rules)],
  ['table session id invariant', /request\.resource\.data\.id == sessionId/.test(rules)],
];
const failed = securityInvariants.filter(([,ok])=>!ok).map(([name])=>name);
if (failed.length) { console.error('RELEASE_SECURITY_INVARIANTS_FAILED', failed.join(',')); process.exit(1); }
console.log('RELEASE_STATIC_GATE_PASS');
