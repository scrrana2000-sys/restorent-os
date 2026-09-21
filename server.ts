import express from 'express';
import { randomBytes } from 'node:crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { auth } from './src/config/firebase';
import { submitServerOnlineOrder, submitServerPosOrder } from './src/server/onlineOrderService';
import { sanitizeCustomerOrder } from './src/services/customerOrderTrackingService';
import { resolveRestaurantBySlug } from './src/services/customerDiscoveryService';
import { collection, getDocs, getDoc, query, where } from 'firebase/firestore';
import { db } from './src/config/firebase';
import fs from 'fs';
import {
  verifyFirebaseToken,
  verifyRestaurantStaffAuthorization,
  verifyRestaurantStaffRole,
  verifyRestaurantOwnerForSubscription,
  ensureServerAuthenticated,
  checkRateLimit
} from './src/server/invitationAuth';
import {
  getPublicRazorpayKeyId,
  createRazorpayOrder,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
  processRazorpayWebhookPayload,
  activateSubscriptionInFirestore,
  ensureRestaurantTrialInFirestore,
  recordSubscriptionAudit,
  validateSelfServePlan
} from './src/server/razorpayService';
import { stockConsumptionService } from './src/services/stockConsumptionService';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getPlanById } from './src/config/subscriptionPlans';
import { adminDb, adminAuth, adminStorageBucket } from './src/server/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
app.set('trust proxy', 1);

const DEFAULT_PRODUCTION_ORIGINS = [
  'https://restaurantos01.ai.studio',
  'https://antos01.ai.studio',
  'https://restaurantos-xqi52dpwga-el.a.run.app',
  'https://scrrana2000-sys.github.io'
];

function requireProductionSecrets() {
  if (process.env.NODE_ENV !== 'production') return;
  // Payment provider secrets are optional at container startup. The API starts normally
  // and payment endpoints return a controlled configuration error until real secrets exist.
  const required = ['ALLOWED_ORIGINS', 'PUBLIC_APP_URL'];

  // Environment-aware resolution for production: ensure HTTPS production defaults if unset, malformed, or containing localhost
  try {
    const parsedUrl = new URL(process.env.PUBLIC_APP_URL || '');
    if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
      process.env.PUBLIC_APP_URL = 'https://restaurantos01.ai.studio';
    }
  } catch {
    process.env.PUBLIC_APP_URL = 'https://restaurantos01.ai.studio';
  }

  const rawOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => {
      if (!v || v === '*' || v.startsWith('http://localhost') || v.startsWith('http://127.0.0.1')) return false;
      try {
        const u = new URL(v);
        return u.protocol === 'https:';
      } catch {
        return false;
      }
    });
  const resolvedOrigins = Array.from(new Set([...(rawOrigins.length > 0 ? rawOrigins : DEFAULT_PRODUCTION_ORIGINS)]));
  process.env.ALLOWED_ORIGINS = resolvedOrigins.join(',');

  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  const configuredOrigins = process.env.ALLOWED_ORIGINS!.split(',').map((v) => v.trim()).filter(Boolean);
  if (configuredOrigins.length === 0) throw new Error('ALLOWED_ORIGINS must contain at least one exact origin.');
  let publicUrl: URL;
  try {
    publicUrl = new URL(process.env.PUBLIC_APP_URL!);
  } catch {
    throw new Error('PUBLIC_APP_URL must be a valid absolute URL.');
  }
  if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) {
    throw new Error('PUBLIC_APP_URL must be an HTTPS origin URL without credentials, query, or hash.');
  }
  for (const origin of configuredOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error(`ALLOWED_ORIGINS must contain exact HTTPS origins only: ${origin}`);
    }
  }
}

app.use(
  express.json({
    limit: '200kb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

// Exact-origin CORS middleware. Production requires ALLOWED_ORIGINS to be explicitly configured.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    const defaultOrigins = process.env.NODE_ENV === 'production'
      ? DEFAULT_PRODUCTION_ORIGINS.join(',')
      : 'http://localhost:3000,http://127.0.0.1:3000';
    const configuredOrigins = (process.env.ALLOWED_ORIGINS || defaultOrigins)
      .split(',').map((value) => value.trim()).filter(Boolean);
    let isAllowed = configuredOrigins.includes(origin);
    if (!isAllowed) {
      try {
        const parsedOrigin = new URL(origin);
        const hostHeader = req.headers.host;
        const hostname = parsedOrigin.hostname.toLowerCase();
        const isSameHost = Boolean(hostHeader && (parsedOrigin.host === hostHeader || origin.includes(hostHeader)));
        if (isSameHost) {
          isAllowed = true;
        } else if (
          // Google AI Studio preview origins are ephemeral ais-dev-*.run.app hosts.
          // They are not practical to enumerate in ALLOWED_ORIGINS, but customer
          // and owner API calls are still protected by Firebase authentication or
          // server-side authorization. Keep this limited to the AI Studio preview
          // hostname pattern rather than allowing arbitrary *.run.app origins.
          hostname.startsWith('ais-dev-') &&
          hostname.endsWith('.run.app')
        ) {
          isAllowed = true;
        } else if (process.env.NODE_ENV !== 'production') {
          isAllowed =
            hostname.endsWith('.run.app') ||
            hostname.endsWith('.aistudio.google.com') ||
            hostname.endsWith('.studio.googleusercontent.com') ||
            hostname.endsWith('.google.com') ||
            hostname.endsWith('.googleusercontent.com') ||
            hostname.endsWith('.web.app') ||
            hostname.endsWith('.firebaseapp.com') ||
            hostname === 'localhost' ||
            hostname === '127.0.0.1';
        }
      } catch {
        isAllowed = false;
      }
    }

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With, X-Razorpay-Signature, X-Razorpay-Event-Id'
      );
      res.setHeader('Access-Control-Allow-Credentials', 'false');
    }
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// Normalize /restorent-os subpath at top level so both /api and /restorent-os/api work consistently
app.use((req, _res, next) => {
  if (req.url.startsWith('/restorent-os/')) {
    req.url = req.url.slice('/restorent-os'.length) || '/';
  } else if (req.url === '/restorent-os') {
    req.url = '/';
  }
  next();
});

// Permanently delete a restaurant owned by the authenticated user and restore
// that same Firebase UID to customer mode. This uses the Admin SDK because
// Firestore client rules intentionally do not expose recursive tenant deletion.
app.post('/api/account/delete-restaurant', async (req, res) => {
  try {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const caller = await verifyFirebaseToken(token);
    if (!caller) return res.status(401).json({ success: false, message: 'Authentication required.' });

    const restaurantId = String(req.body?.restaurantId || '').trim();
    const confirmationName = String(req.body?.confirmationName || '').trim();
    if (!restaurantId || !confirmationName) {
      return res.status(400).json({ success: false, message: 'Restaurant ID and exact restaurant-name confirmation are required.' });
    }

    const restaurantRef = adminDb.doc(`restaurants/${restaurantId}`);
    const restaurantSnap = await restaurantRef.get();
    if (!restaurantSnap.exists) return res.status(404).json({ success: false, message: 'Restaurant not found.' });

    const restaurant = restaurantSnap.data() || {};
    if (restaurant.ownerId !== caller.uid) {
      return res.status(403).json({ success: false, message: 'Only the restaurant owner can permanently delete this restaurant.' });
    }
    if (restaurant.name !== confirmationName) {
      return res.status(400).json({ success: false, message: 'Restaurant-name confirmation does not match.' });
    }

    const customerRef = adminDb.doc(`customers/${caller.uid}`);
    const userRef = adminDb.doc(`users/${caller.uid}`);
    const customerSnap = await customerRef.get();
    let authUser: { displayName?: string; email?: string; phoneNumber?: string; photoURL?: string; providerData?: any[] } = caller;
    try {
      authUser = await adminAuth.getUser(caller.uid);
    } catch (authErr) {
      console.warn('[RestaurantOS Server] adminAuth.getUser fallback for customer restoration:', authErr);
    }

    await adminDb.recursiveDelete(restaurantRef);
    await adminDb.doc(`publicRestaurants/${restaurantId}`).delete().catch(() => undefined);
    // All restaurant uploads are tenant-scoped under /restaurants/{restaurantId}/.
    // Storage deletion is best-effort so a missing/unconfigured bucket cannot
    // prevent Firestore/account restoration after the tenant is deleted.
    try {
      await adminStorageBucket.deleteFiles({ prefix: `restaurants/${restaurantId}/` });
    } catch (storageErr) {
      console.warn('[RestaurantOS Account Lifecycle] Storage cleanup warning:', storageErr);
    }

    if (customerSnap.exists) {
      await customerRef.set({
        accountStatus: 'active',
        blockedAt: FieldValue.delete(),
        blockedReason: FieldValue.delete(),
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } else {
      await customerRef.set({
        customerId: caller.uid,
        name: authUser.displayName || authUser.email?.split('@')[0] || 'Customer',
        email: authUser.email || '',
        phone: authUser.phoneNumber || '',
        photoURL: authUser.photoURL || null,
        authProvider: authUser.providerData?.[0]?.providerId || 'google.com',
        addresses: [],
        accountStatus: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    await userRef.set({
      userId: caller.uid,
      displayName: authUser.displayName || authUser.email?.split('@')[0] || 'Customer',
      email: authUser.email || '',
      photoUrl: authUser.photoURL || null,
      updatedAt: new Date().toISOString(),
      restaurantId: FieldValue.delete(),
      initialRestaurantId: FieldValue.delete()
    }, { merge: true });

    console.log('[RestaurantOS Account Lifecycle] Restaurant permanently deleted and customer access restored:', {
      callerUid: caller.uid,
      restaurantId
    });
    return res.json({ success: true, restoredAccount: 'customer' });
  } catch (err: any) {
    console.error('[RestaurantOS Account Lifecycle] Restaurant deletion failed:', err);
    return res.status(500).json({ success: false, message: 'Restaurant deletion failed. Please retry; the account was not intentionally converted.' });
  }
});

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'restaurantos-api'
  });
});

// ---------------------------------------------------------------------------
// SEO: dynamic sitemap.xml
// ---------------------------------------------------------------------------
// Restaurant public pages are created by owners at runtime, so they can't be listed in the
// static public/sitemap.xml shipped with the build. On the Express/Cloud Run deployment
// (where this file actually runs as a server, unlike static GitHub Pages hosting), this route
// lists every currently-active publicRestaurants document as a crawlable /r/:slug URL.
app.get('/sitemap.xml', async (req, res) => {
  const origin = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
  const urls: string[] = [
    `<url><loc>${origin}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`
  ];

  try {
    const publicCol = collection(db, 'publicRestaurants');
    const activeQuery = query(publicCol, where('publicStatus', '==', 'active'));
    const snapshot = await getDocs(activeQuery);

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (!data.publicSlug) return;
      const lastmod = typeof data.updatedAt === 'string' ? data.updatedAt.slice(0, 10) : undefined;
      const loc = `${origin}/r/${encodeURIComponent(data.publicSlug)}/menu`;
      urls.push(
        `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<changefreq>daily</changefreq><priority>0.8</priority></url>`
      );
    });
  } catch (err: any) {
    // If Firestore is unreachable, still return a valid sitemap with just the homepage
    // rather than failing the request outright.
    console.warn('[RestaurantOS Server] Dynamic sitemap: could not list public restaurants:', err?.message || err);
  }

  res.header('Content-Type', 'application/xml');
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`
  );
});

// ---------------------------------------------------------------------------
// SEO: server-side meta tag injection for public restaurant pages
// ---------------------------------------------------------------------------
// RestaurantOS is a client-rendered SPA, so a crawler that doesn't execute JavaScript only
// ever sees the generic title/description in index.html — the restaurant's actual name,
// cuisine, and location never reach it. This does not attempt full server-side rendering of
// the React app (too invasive to safely retrofit here); it only rewrites the <head> meta tags
// for the specific public, unauthenticated restaurant pages (/r/:slug and /r/:slug/menu)
// before the SPA shell is sent, so search engines and link-preview bots see real content.
// The React app then mounts and hydrates normally on top of this HTML for real users.
//
// Known limitation: this only helps when the page is requested by its real path
// (https://host/r/:slug). On static GitHub Pages hosting, the app's default shareable link
// format is a hash route (#r/:slug), which browsers never send to any server, so this
// middleware can't see or rewrite it there — hash-based sharing links stay
// generic-metadata-only on GitHub Pages. This only fully works on the Express/Cloud Run
// deployment. Prefer path-based /r/:slug links over #r/:slug when SEO/link-preview quality
// matters (e.g. sharing on WhatsApp, Instagram bio, Google Business Profile).
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function injectPublicRestaurantMeta(req: express.Request, indexHtml: string): Promise<string> {
  const match = req.path.match(/^\/r\/([^/]+)(?:\/menu)?\/?$/);
  if (!match) return indexHtml;

  const slug = decodeURIComponent(match[1]);
  try {
    const profile = await resolveRestaurantBySlug(slug);
    if (!profile) return indexHtml;

    const cuisineText = profile.cuisine.length ? profile.cuisine.join(', ') : 'Multi-cuisine';
    const locationText = [profile.area, profile.city].filter(Boolean).join(', ');
    const title = `${profile.name} — Order Online${locationText ? ` in ${locationText}` : ''} | RestaurantOS`;
    const description = `Order online from ${profile.name}${locationText ? ` in ${locationText}` : ''}. ${cuisineText} cuisine. View the live menu and order pickup or delivery.`;
    const image = profile.coverImageUrl || profile.logoUrl || '';
    const baseOrigin = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
    const pageUrl = `${baseOrigin}${req.originalUrl}`;

    let html = indexHtml;
    html = html.replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(title)}</title>`);
    html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${escapeHtml(description)}$2`);
    html = html.replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${escapeHtml(title)}$2`);
    html = html.replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${escapeHtml(description)}$2`);
    html = html.replace(
      '</head>',
      `${image ? `<meta property="og:image" content="${escapeHtml(image)}">\n` : ''}<link rel="canonical" href="${escapeHtml(pageUrl)}">\n</head>`
    );
    return html;
  } catch (err: any) {
    console.warn('[RestaurantOS Server] Meta injection skipped for', slug, err?.message || err);
    return indexHtml;
  }
}

const onlineOrderIpLimits = new Map<string, number[]>();

function checkOnlineOrderIpLimit(ip: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 10; // Max 10 submissions per minute per IP

  let timestamps = onlineOrderIpLimits.get(ip) || [];
  timestamps = timestamps.filter(t => now - t < windowMs);
  onlineOrderIpLimits.set(ip, timestamps);

  if (timestamps.length >= maxRequests) {
    const oldest = timestamps[0];
    const retryAfter = Math.ceil((windowMs - (now - oldest)) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfter) };
  }

  timestamps.push(now);
  if (onlineOrderIpLimits.size > 10000) {
    for (const [key, values] of onlineOrderIpLimits) {
      if (values.length === 0 || now - values[values.length - 1] > windowMs) onlineOrderIpLimits.delete(key);
    }
  }
  return { allowed: true };
}

function extractBearerToken(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Trusted KOT creation boundary.
 */
app.post('/api/kots/create', async (req, res) => {
  try {
    const idToken = extractBearerToken(req);
    if (!idToken) return res.status(401).json({ success: false, error: 'UNAUTHENTICATED', message: 'Authentication token is required.' });
    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser) return res.status(401).json({ success: false, error: 'INVALID_TOKEN', message: 'Authentication token is invalid or expired.' });

    const restaurantId = String(req.body?.restaurantId || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    if (!restaurantId || !orderId) {
      return res.status(400).json({ success: false, error: 'MISSING_PARAMETERS', message: 'restaurantId and orderId are required.' });
    }

    const staffCheck = await verifyRestaurantStaffRole(
      authUser.uid,
      idToken,
      restaurantId,
      ['owner', 'manager', 'cashier', 'captain']
    );
    if (!staffCheck.authorized) {
      return res.status(staffCheck.code || 403).json({
        success: false,
        error: staffCheck.error || 'FORBIDDEN',
        message: staffCheck.message || 'Caller is not authorized to create KOTs.'
      });
    }

    if (!(await ensureServerAuthenticated())) {
      return res.status(503).json({ success: false, error: 'SERVER_AUTH_UNAVAILABLE', message: 'Trusted KOT service is unavailable.' });
    }

    const { kotService } = await import('./src/services/kotService');
    const rawClientRequestId = String(req.body?.clientRequestId || '').trim();
    const input = {
      restaurantId,
      orderId,
      items: Array.isArray(req.body?.items) ? req.body.items : undefined,
      notes: typeof req.body?.notes === 'string' ? req.body.notes : '',
      createdBy: authUser.uid,
      clientRequestId: rawClientRequestId ? `${authUser.uid}_${rawClientRequestId}` : undefined
    };
    const kot = await kotService.createKOTFromOrder(input);
    return res.json({ success: true, kot });
  } catch (err) {
    console.error('[RestaurantOS Server] KOT creation failed:', err);
    return res.status(400).json({ success: false, error: 'KOT_CREATION_FAILED', message: err?.message || 'Failed to create KOT.' });
  }
});

/**
 * Server-authoritative partial KOT item cancellation.
 * Caller roles are checked before the trusted server identity performs the write.
 */
app.post('/api/kots/partial-cancel', async (req, res) => {
  try {
    const idToken = extractBearerToken(req);
    if (!idToken) return res.status(401).json({ success: false, error: 'UNAUTHENTICATED', message: 'Authentication token is required.' });

    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser?.uid) return res.status(401).json({ success: false, error: 'INVALID_TOKEN', message: 'Authentication token is invalid or expired.' });

    const restaurantId = String(req.body?.restaurantId || '').trim();
    const kotId = String(req.body?.kotId || '').trim();
    const cancellations = req.body?.cancellations;
    if (!restaurantId || !kotId || !Array.isArray(cancellations) || cancellations.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_PARAMETERS',
        message: 'restaurantId, kotId and cancellations are required.'
      });
    }

    const staffCheck = await verifyRestaurantStaffRole(
      authUser.uid,
      idToken,
      restaurantId,
      ['owner', 'manager', 'captain', 'kitchen']
    );
    if (!staffCheck.authorized) {
      return res.status(staffCheck.code || 403).json({
        success: false,
        error: staffCheck.error || 'FORBIDDEN',
        message: staffCheck.message || 'Caller is not authorized to partially cancel KOT items.'
      });
    }

    if (!(await ensureServerAuthenticated())) {
      return res.status(503).json({
        success: false,
        error: 'SERVER_AUTH_UNAVAILABLE',
        message: 'Trusted KOT cancellation service is unavailable.'
      });
    }

    const safeCancellations = cancellations
      .map((item: any) => ({
        itemId: String(item?.itemId || '').trim(),
        cancelledQuantity: Number(item?.cancelledQuantity),
        reason: typeof item?.reason === 'string' ? item.reason.trim() : ''
      }))
      .filter((item: any) =>
        item.itemId &&
        Number.isInteger(item.cancelledQuantity) &&
        item.cancelledQuantity > 0
      );

    if (!safeCancellations.length) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_CANCELLATIONS',
        message: 'No valid item cancellations were provided.'
      });
    }

    const clientRequestId = String(req.body?.clientRequestId || '').trim();
    const { kotService } = await import('./src/services/kotService');
    const result = await kotService.partiallyCancelKOTItems(
      restaurantId,
      kotId,
      safeCancellations,
      authUser.uid,
      clientRequestId ? `${authUser.uid}_${clientRequestId}` : undefined
    );

    return res.json({ success: true, kot: result });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Partial KOT cancellation failed:', err);
    return res.status(400).json({
      success: false,
      error: 'KOT_PARTIAL_CANCELLATION_FAILED',
      message: err?.message || 'Failed to partially cancel KOT items.'
    });
  }
});

app.post('/api/orders/create-pos', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Bearer authentication token is required.' });
    const idToken = authHeader.substring(7).trim();
    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser?.uid) return res.status(401).json({ success: false, error: 'INVALID_AUTH_TOKEN', message: 'Invalid or expired Firebase authentication token.' });

    const restaurantId = String(req.body?.restaurantId || '').trim();
    const source = String(req.body?.source || '').trim();
    const orderType = String(req.body?.orderType || '').trim() as 'dineIn' | 'takeaway' | 'delivery';
    if (!restaurantId || !req.body?.cartState || !source || !orderType) return res.status(400).json({ success: false, error: 'MISSING_PARAMETERS', message: 'restaurantId, cartState, source and orderType are required.' });
    if (!new Set(['pos', 'captain', 'admin', 'api']).has(source) || source === 'online') return res.status(400).json({ success: false, error: 'INVALID_SOURCE', message: 'Online or unsupported order sources must use their dedicated trusted workflow.' });
    if (!new Set(['dineIn', 'takeaway', 'delivery']).has(orderType)) return res.status(400).json({ success: false, error: 'INVALID_ORDER_TYPE', message: 'Unsupported POS order type.' });

    const staffCheck = await verifyRestaurantStaffRole(authUser.uid, idToken, restaurantId, ['owner', 'manager', 'cashier', 'captain']);
    if (!staffCheck.authorized) return res.status(staffCheck.code || 403).json({ success: false, error: staffCheck.error || 'FORBIDDEN', message: staffCheck.message || 'Caller is not authorized to create POS orders.' });

    const result = await submitServerPosOrder({
      restaurantId,
      cartState: req.body.cartState,
      orderType,
      source,
      tableId: req.body?.tableId || null,
      tableSessionId: req.body?.tableSessionId || null,
      customerSnapshot: req.body?.customerSnapshot || null,
      notes: typeof req.body?.notes === 'string' ? req.body.notes : '',
      taxJurisdiction: req.body?.taxJurisdiction || 'intraState',
      createdBy: authUser.uid,
      clientRequestId: typeof req.body?.clientRequestId === 'string' ? req.body.clientRequestId.trim() : undefined,
      skipTableSessionValidation: Boolean(req.body?.skipTableSessionValidation),
      createKot: Boolean(req.body?.createKot)
    });
    return res.json({ success: true, order: result.order, kot: result.kot });
  } catch (err: any) {
    console.error('[RestaurantOS Server] POS order creation failed:', err);
    return res.status(400).json({ success: false, error: 'POS_ORDER_CREATION_FAILED', message: err?.message || 'Failed to create POS order.' });
  }
});
app.post('/api/submit-online-order', async (req, res) => {
  try {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown-ip';

    const rateCheck = checkOnlineOrderIpLimit(clientIp);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSeconds || 60));
      return res.status(429).json({
        success: false,
        error: 'RATE_LIMITED',
        message: `Too many order submissions. Please wait ${rateCheck.retryAfterSeconds} seconds before trying again.`
      });
    }

    // 1. Resolve & Verify Customer Identity if token provided
    const authHeader = req.headers.authorization;
    let verifiedCustomerId: string | null = null;
    let verifiedCustomerEmail: string | undefined = undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.substring(7).trim();
      if (idToken) {
        const verifiedUser = await verifyFirebaseToken(idToken);
        if (!verifiedUser || !verifiedUser.uid) {
          return res.status(401).json({
            success: false,
            error: 'INVALID_AUTH_TOKEN',
            message: 'Customer authentication token could not be verified.'
          });
        }
        verifiedCustomerId = verifiedUser.uid;
        verifiedCustomerEmail = verifiedUser.email;
      }
    }

    const {
      intent,
      cart,
      restaurantProfile,
      menuItems,
      orderType,
      customerDetails,
      deliveryDetails,
      paymentMethod,
      idempotencyKey,
      operatingProfile,
      customerId: bodyCustomerId,
      customerEmail: bodyCustomerEmail
    } = req.body;

    const requestedCustomerId = bodyCustomerId || intent?.customerId;

    // SECURITY CHECK:
    // A customer MUST NOT be able to submit customerId = another customer's UID.
    // Never allow request body customerId != authenticated Firebase UID.
    if (requestedCustomerId) {
      if (!verifiedCustomerId) {
        return res.status(403).json({
          success: false,
          error: 'UNAUTHORIZED_CUSTOMER_ID',
          message: 'Security Violation: Cannot submit order with customerId without verified authentication credentials.'
        });
      }
      if (requestedCustomerId !== verifiedCustomerId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_CUSTOMER_SPOOFING',
          message: 'Security Violation: Provided customerId does not match authenticated user identity.'
        });
      }
    }

    // Authoritative customerId derived strictly from authenticated context (or null for guests)
    const effectiveCustomerId = verifiedCustomerId || null;
    const effectiveCustomerEmail = verifiedCustomerEmail || bodyCustomerEmail || intent?.customerEmail || customerDetails?.email;

    const guestTrackingToken = randomBytes(32).toString('base64url');

    // The browser normally submits a validated CustomerCheckoutIntent. Reconstruct
    // the canonical cart when the transport payload does not also carry cart.
    const effectiveCart = cart || (intent ? {
      restaurantId: intent.restaurantId,
      restaurantName: intent.restaurantName || '',
      publicSlug: '',
      items: Array.isArray(intent.items) ? intent.items : [],
      subtotal: Number(intent.subtotal) || 0,
      itemCount: Array.isArray(intent.items)
        ? intent.items.reduce((sum: number, item: any) => sum + Number(item?.quantity || 0), 0)
        : 0
    } : null);

    const effectiveOrderType = orderType || intent?.orderType;
    const effectiveCustomerDetails = customerDetails || intent?.customerDetails;
    const effectiveDeliveryDetails = deliveryDetails || intent?.deliveryDetails;
    const effectivePaymentMethod = paymentMethod || intent?.paymentMethod || 'cash';
    const effectiveIdempotencyKey = idempotencyKey || intent?.idempotencyKey;

    if (!effectiveCart || !effectiveCustomerDetails || !effectiveOrderType) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_CHECKOUT_DATA',
        message: 'Cart, customer details, and order type are required.'
      });
    }

    const result = await submitServerOnlineOrder({
      intent,
      cart: effectiveCart,
      restaurantProfile,
      orderType: effectiveOrderType,
      customerDetails: effectiveCustomerDetails,
      deliveryDetails: effectiveDeliveryDetails,
      paymentMethod: effectivePaymentMethod,
      idempotencyKey: effectiveIdempotencyKey,
      customerId: effectiveCustomerId,
      customerEmail: effectiveCustomerEmail,
      customerTrackingToken: guestTrackingToken
    });

    return res.json({
      success: true,
      order: result.order,
      kot: result.kot
    });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Online order submission failed:', err);
    return res.status(400).json({
      success: false,
      error: 'ORDER_SUBMISSION_FAILED',
      message: err?.message || 'Failed to submit online order.'
    });
  }
});

/**
 * Guest order tracking endpoint. Requires the server-generated opaque tracking token.
 * Returns only the sanitized customer-facing order projection.
 */
app.post('/api/orders/track', async (req, res) => {
  try {
    const restaurantId = String(req.body?.restaurantId || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    const trackingToken = String(req.body?.trackingToken || '').trim();

    if (!restaurantId || !orderId || trackingToken.length < 32 || trackingToken.length > 256) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_TRACKING_REQUEST',
        message: 'Valid restaurantId, orderId, and trackingToken are required.'
      });
    }

    const authenticated = await ensureServerAuthenticated();
    if (!authenticated) {
      return res.status(503).json({
        success: false,
        error: 'SERVER_AUTH_UNAVAILABLE',
        message: 'Order tracking service is temporarily unavailable.'
      });
    }

    const orderRef = doc(db, 'restaurants', restaurantId, 'orders', orderId);
    const snapshot = await getDoc(orderRef);
    if (!snapshot.exists()) {
      return res.status(404).json({ success: false, error: 'ORDER_NOT_FOUND', message: 'Order not found.' });
    }

    const order = { id: snapshot.id, ...snapshot.data() } as any;
    if (order.restaurantId !== restaurantId || order.source !== 'online' || order.customerId) {
      return res.status(403).json({ success: false, error: 'TRACKING_FORBIDDEN', message: 'This order is not available for guest tracking.' });
    }

    if (order.customerTrackingToken !== trackingToken) {
      return res.status(403).json({ success: false, error: 'INVALID_TRACKING_TOKEN', message: 'Invalid order tracking token.' });
    }

    return res.json({ success: true, order: sanitizeCustomerOrder(order) });
  } catch (err: any) {
    console.warn('[RestaurantOS Server] Guest order tracking failed:', err?.message || err);
    return res.status(400).json({ success: false, error: 'ORDER_TRACKING_FAILED', message: 'Unable to load order tracking.' });
  }
});

/**
 * Public digital invoice endpoint. Requires the server-generated opaque order token.
 * Never exposes the raw Firestore order document to unauthenticated browser clients.
 */
app.post('/api/orders/public-bill', async (req, res) => {
  try {
    const restaurantId = String(req.body?.restaurantId || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    const accessToken = String(req.body?.accessToken || '').trim();

    if (!restaurantId || !orderId || accessToken.length < 32 || accessToken.length > 256) {
      return res.status(400).json({ success: false, error: 'INVALID_BILL_REQUEST', message: 'Valid restaurantId, orderId, and accessToken are required.' });
    }

    const authenticated = await ensureServerAuthenticated();
    if (!authenticated) {
      return res.status(503).json({ success: false, error: 'SERVER_AUTH_UNAVAILABLE', message: 'Invoice service is temporarily unavailable.' });
    }

    const orderRef = doc(db, 'restaurants', restaurantId, 'orders', orderId);
    const orderSnap = await getDoc(orderRef);
    if (!orderSnap.exists()) {
      return res.status(404).json({ success: false, error: 'ORDER_NOT_FOUND', message: 'Invoice not found.' });
    }

    const order = { id: orderSnap.id, ...orderSnap.data() } as any;
    if (order.restaurantId !== restaurantId || order.source !== 'online' || order.customerTrackingToken !== accessToken) {
      return res.status(403).json({ success: false, error: 'BILL_FORBIDDEN', message: 'Invalid invoice access token.' });
    }

    const publicRestaurantRef = doc(db, 'publicRestaurants', restaurantId);
    const restaurantSnap = await getDoc(publicRestaurantRef);
    const restaurant = restaurantSnap.exists() ? restaurantSnap.data() : null;

    return res.json({
      success: true,
      order: sanitizeCustomerOrder(order),
      restaurant: restaurant ? {
        restaurantId: restaurant.restaurantId || restaurantId,
        name: restaurant.name || 'Restaurant',
        phone: restaurant.phone || '',
        address: restaurant.address || '',
        city: restaurant.city || '',
        state: restaurant.state || '',
        currency: restaurant.currency || 'INR',
        currencySymbol: restaurant.currencySymbol || '₹',
        gstNumber: restaurant.gstNumber || restaurant.gstin || null
      } : null
    });
  } catch (err: any) {
    console.warn('[RestaurantOS Server] Public bill retrieval failed:', err?.message || err);
    return res.status(400).json({ success: false, error: 'PUBLIC_BILL_FAILED', message: 'Unable to load the invoice.' });
  }
});

/**
 * Hardened endpoint to send official RestaurantOS staff invitation email.
 * Requires verified Firebase ID Token in Authorization: Bearer <ID_TOKEN>
 * Enforces ownership / manage_staff permission for the target restaurant.
 * Strictly resolves restaurant name and role server-side (never trusts client spoofing).
 */
app.post('/api/send-invitation-email', async (req, res) => {
  // 1. Enforce Bearer Token Authentication
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Missing or malformed Authorization header. Bearer token required.'
    });
  }

  const idToken = authHeader.substring(7).trim();
  if (!idToken) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Empty Bearer authentication token.'
    });
  }

  // 2. Cryptographic token verification (Google Identity Toolkit / test mock)
  const authUser = await verifyFirebaseToken(idToken);
  if (!authUser || !authUser.uid) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_AUTH_TOKEN',
      message: 'Invalid or expired Firebase authentication token.'
    });
  }

  const { restaurantId, invitationId, toEmail, invitationUrl } = req.body;

  if (!restaurantId || !toEmail || !invitationUrl) {
    return res.status(400).json({
      success: false,
      error: 'MISSING_PARAMETERS',
      message: 'restaurantId, toEmail, and invitationUrl are required.'
    });
  }

  const cleanRestaurantId = String(restaurantId).trim();
  const cleanInvitationId = String(invitationId || '').trim();
  const cleanEmail = String(toEmail).trim().toLowerCase();

  // 3. Abuse prevention: Rate limiting by caller UID and recipient email
  const rateLimitCheck = checkRateLimit(authUser.uid, cleanEmail);
  if (!rateLimitCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: 'RATE_LIMITED',
      message: `Too many invitation requests. Please wait ${rateLimitCheck.retryAfterSeconds} seconds before trying again.`
    });
  }

  // 4. Authoritative Restaurant & Invitation Verification
  // Derives caller authorization, ensures caller cannot invite for other restaurants,
  // and resolves restaurantName and role directly from authoritative database records.
  const authCheck = await verifyRestaurantStaffAuthorization(
    authUser.uid,
    idToken,
    cleanRestaurantId,
    cleanInvitationId,
    cleanEmail
  );

  if (!authCheck.authorized) {
    return res.status(authCheck.code || 403).json({
      success: false,
      error: authCheck.error || 'FORBIDDEN',
      message: authCheck.message || 'Caller is not authorized to manage staff for this restaurant.'
    });
  }

  // Authoritative verified details: NEVER client-spoofed
  const cleanRestaurant = authCheck.authoritativeData?.restaurantName || 'RestaurantOS';
  const cleanName = authCheck.authoritativeData?.staffName || 'Staff Member';
  const cleanRole = (authCheck.authoritativeData?.role || 'Staff').toUpperCase();

  // Check for available email dispatch credentials
  const resendApiKey = process.env.RESEND_API_KEY;
  const sendgridApiKey = process.env.SENDGRID_API_KEY;
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  console.log(`[RestaurantOS Server] Dispatching verified staff invitation for ${cleanEmail} at ${cleanRestaurant} (Role: ${cleanRole}, Caller: ${authUser.uid})...`);

  // 1. Resend API Integration
  if (resendApiKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'RestaurantOS <invitations@restaurantos.app>',
          to: [cleanEmail],
          subject: `You're invited to join ${cleanRestaurant} as ${cleanRole}`,
          html: buildEmailTemplate({ name: cleanName, role: cleanRole, restaurantName: cleanRestaurant, url: invitationUrl }),
          text: `Hi ${cleanName},\n\nYou have been invited to join ${cleanRestaurant} as ${cleanRole}.\nAccept your invitation here: ${invitationUrl}`
        })
      });

      if (response.ok) {
        console.log(`[RestaurantOS Server] Resend email dispatched to ${cleanEmail}`);
        return res.json({ success: true, provider: 'resend', message: `Invitation email sent to ${cleanEmail}` });
      } else {
        const errData = await response.json();
        console.error('[RestaurantOS Server] Resend dispatch failed:', errData);
        return res.status(502).json({
          success: false,
          error: 'PROVIDER_DISPATCH_FAILED',
          message: `Resend error: ${errData.message || JSON.stringify(errData)}`
        });
      }
    } catch (err: any) {
      console.error('[RestaurantOS Server] Resend request exception:', err);
      return res.status(500).json({ success: false, error: 'SERVER_EMAIL_ERROR', message: err?.message || 'Resend request failed' });
    }
  }

  // 2. SendGrid API Integration
  if (sendgridApiKey) {
    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sendgridApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: cleanEmail }] }],
          from: { email: process.env.EMAIL_FROM_ADDRESS || 'invitations@restaurantos.app', name: 'RestaurantOS' },
          subject: `You're invited to join ${cleanRestaurant} as ${cleanRole}`,
          content: [
            {
              type: 'text/html',
              value: buildEmailTemplate({ name: cleanName, role: cleanRole, restaurantName: cleanRestaurant, url: invitationUrl })
            }
          ]
        })
      });

      if (response.status >= 200 && response.status < 300) {
        console.log(`[RestaurantOS Server] SendGrid email dispatched to ${cleanEmail}`);
        return res.json({ success: true, provider: 'sendgrid', message: `Invitation email sent to ${cleanEmail}` });
      } else {
        const errText = await response.text();
        console.error('[RestaurantOS Server] SendGrid dispatch failed:', errText);
        return res.status(502).json({ success: false, error: 'PROVIDER_DISPATCH_FAILED', message: `SendGrid error: ${errText}` });
      }
    } catch (err: any) {
      console.error('[RestaurantOS Server] SendGrid request exception:', err);
      return res.status(500).json({ success: false, error: 'SERVER_EMAIL_ERROR', message: err?.message || 'SendGrid request failed' });
    }
  }

  // 3. SMTP Integration (Nodemailer)
  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Boolean(process.env.SMTP_SECURE === 'true'),
        auth: { user: smtpUser, pass: smtpPass }
      });

      await transporter.sendMail({
        from: process.env.EMAIL_FROM || `"RestaurantOS" <${smtpUser}>`,
        to: cleanEmail,
        subject: `You're invited to join ${cleanRestaurant} as ${cleanRole}`,
        html: buildEmailTemplate({ name: cleanName, role: cleanRole, restaurantName: cleanRestaurant, url: invitationUrl }),
        text: `Hi ${cleanName},\n\nYou have been invited to join ${cleanRestaurant} as ${cleanRole}.\nAccept your invitation here: ${invitationUrl}`
      });

      console.log(`[RestaurantOS Server] SMTP email dispatched to ${cleanEmail}`);
      return res.json({ success: true, provider: 'smtp', message: `Invitation email sent to ${cleanEmail}` });
    } catch (err: any) {
      console.error('[RestaurantOS Server] SMTP dispatch failed:', err);
      return res.status(502).json({ success: false, error: 'SMTP_DISPATCH_FAILED', message: err?.message || 'SMTP sending failed' });
    }
  }

  // 4. Fallback when NO email credentials exist in environment variables
  console.warn(
    `[RestaurantOS Server] No SMTP or Email Provider API key configured in environment variables (RESEND_API_KEY, SENDGRID_API_KEY, or SMTP_HOST). Email dispatch not possible.`
  );

  return res.status(503).json({
    success: false,
    error: 'NO_EMAIL_PROVIDER_CONFIGURED',
    message: 'No transactional email service provider or SMTP server is configured in environment variables. Automated email delivery is unavailable.'
  });
});

function buildEmailTemplate({ name, role, restaurantName, url }: { name: string; role: string; restaurantName: string; url: string }) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #0f172a; }
          .container { max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
          .header { text-align: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 20px; margin-bottom: 24px; }
          .badge { display: inline-block; background-color: #4f46e5; color: #ffffff; font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 4px 10px; border-radius: 9999px; letter-spacing: 0.5px; }
          .title { font-size: 22px; font-weight: 800; color: #0f172a; margin: 12px 0 6px 0; }
          .subtitle { font-size: 14px; color: #64748b; margin: 0; }
          .content { font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 28px; }
          .card { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0; }
          .btn { display: block; width: 100%; text-align: center; background-color: #4f46e5; color: #ffffff !important; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 24px; border-radius: 12px; box-sizing: border-box; }
          .btn:hover { background-color: #4338ca; }
          .footer { font-size: 12px; color: #94a3b8; text-align: center; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 16px; }
          .url-box { font-family: monospace; font-size: 11px; color: #64748b; word-break: break-all; background: #f1f5f9; padding: 8px; border-radius: 6px; margin-top: 8px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <span class="badge">${restaurantName}</span>
            <h1 class="title">Staff Team Invitation</h1>
            <p class="subtitle">You have been invited to join ${restaurantName}</p>
          </div>
          <div class="content">
            <p>Hello <strong>${name}</strong>,</p>
            <p>You have been assigned the <strong>${role}</strong> role at <strong>${restaurantName}</strong> on RestaurantOS.</p>
            <div class="card">
              <p style="margin: 0 0 6px 0; font-size: 13px; color: #64748b;"><strong>Assigned Role:</strong> ${role}</p>
              <p style="margin: 0; font-size: 13px; color: #64748b;"><strong>Restaurant:</strong> ${restaurantName}</p>
            </div>
            <p>Click the button below to verify your email, accept your staff invitation, and activate your account:</p>
            <a href="${url}" class="btn">Accept Staff Invitation</a>
            <p style="font-size: 12px; color: #64748b; margin-top: 20px;">Or copy and paste this link in your browser:</p>
            <div class="url-box">${url}</div>
          </div>
          <div class="footer">
            <p>This invitation link expires in 7 days. If you did not expect this invitation, you can safely ignore this email.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Subscription Config Endpoint
 * Returns public Razorpay key and currency for client-side checkout initiation.
 */
app.get('/api/subscription/config', (_req, res) => {
  try {
    return res.json({
      success: true,
      keyId: getPublicRazorpayKeyId(),
      currency: 'INR'
    });
  } catch (err: any) {
    console.warn('[RestaurantOS Server] Razorpay is not configured:', err?.message || err);
    return res.status(503).json({
      success: false,
      error: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
      message: 'Razorpay payment configuration is not available yet.'
    });
  }
});

/**
 * Server-authoritative table session endpoints. Browser clients authenticate as staff;
 * the trusted server identity performs the Firestore transaction so session/table rules
 * cannot drift with different preview hosts or stale client permissions.
 */
app.post('/api/table-sessions/active', async (req, res) => {
  try {
    const idToken = extractBearerToken(req);
    if (!idToken) return res.status(401).json({ success: false, error: 'UNAUTHENTICATED', message: 'Bearer authentication token is required.' });
    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser?.uid) return res.status(401).json({ success: false, error: 'INVALID_TOKEN', message: 'Authentication token is invalid or expired.' });
    const restaurantId = String(req.body?.restaurantId || '').trim();
    const tableId = String(req.body?.tableId || '').trim();
    const knownSessionId = String(req.body?.knownSessionId || '').trim() || undefined;
    if (!restaurantId || !tableId) return res.status(400).json({ success: false, error: 'MISSING_PARAMETERS', message: 'restaurantId and tableId are required.' });
    const staffCheck = await verifyRestaurantStaffRole(authUser.uid, idToken, restaurantId, ['owner', 'manager', 'cashier', 'captain']);
    if (!staffCheck.authorized) return res.status(staffCheck.code || 403).json({ success: false, error: staffCheck.error || 'FORBIDDEN', message: staffCheck.message || 'Table-session access is not authorized.' });
    if (!(await ensureServerAuthenticated())) return res.status(503).json({ success: false, error: 'SERVER_AUTH_UNAVAILABLE', message: 'Trusted table-session service is unavailable.' });
    const { tableSessionService } = await import('./src/services/tableSessionService');
    const session = await tableSessionService.getActiveSession(restaurantId, tableId, knownSessionId);
    return res.json({ success: true, session });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Active table-session lookup failed:', err);
    return res.status(400).json({ success: false, error: 'TABLE_SESSION_LOOKUP_FAILED', message: err?.message || 'Failed to load table session.' });
  }
});

app.post('/api/table-sessions/open', async (req, res) => {
  try {
    const idToken = extractBearerToken(req);
    if (!idToken) return res.status(401).json({ success: false, error: 'UNAUTHENTICATED', message: 'Bearer authentication token is required.' });
    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser?.uid) return res.status(401).json({ success: false, error: 'INVALID_TOKEN', message: 'Authentication token is invalid or expired.' });
    const restaurantId = String(req.body?.restaurantId || '').trim();
    const tableId = String(req.body?.tableId || '').trim();
    const guestCount = Number(req.body?.guestCount);
    if (!restaurantId || !tableId || !Number.isInteger(guestCount) || guestCount <= 0) return res.status(400).json({ success: false, error: 'INVALID_PARAMETERS', message: 'restaurantId, tableId and positive integer guestCount are required.' });
    const staffCheck = await verifyRestaurantStaffRole(authUser.uid, idToken, restaurantId, ['owner', 'manager', 'cashier', 'captain']);
    if (!staffCheck.authorized) return res.status(staffCheck.code || 403).json({ success: false, error: staffCheck.error || 'FORBIDDEN', message: staffCheck.message || 'Opening table sessions is not authorized.' });
    if (!(await ensureServerAuthenticated())) return res.status(503).json({ success: false, error: 'SERVER_AUTH_UNAVAILABLE', message: 'Trusted table-session service is unavailable.' });
    const { tableSessionService } = await import('./src/services/tableSessionService');
    const session = await tableSessionService.openSession(restaurantId, tableId, guestCount, authUser.uid, String(req.body?.clientRequestId || '').trim() || undefined);
    return res.json({ success: true, session });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Table-session open failed:', err);
    return res.status(400).json({ success: false, error: 'TABLE_SESSION_OPEN_FAILED', message: err?.message || 'Failed to open table session.' });
  }
});

app.post('/api/table-sessions/close', async (req, res) => {
  try {
    const idToken = extractBearerToken(req);
    if (!idToken) return res.status(401).json({ success: false, error: 'UNAUTHENTICATED', message: 'Bearer authentication token is required.' });
    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser?.uid) return res.status(401).json({ success: false, error: 'INVALID_TOKEN', message: 'Authentication token is invalid or expired.' });
    const restaurantId = String(req.body?.restaurantId || '').trim();
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!restaurantId || !sessionId) return res.status(400).json({ success: false, error: 'MISSING_PARAMETERS', message: 'restaurantId and sessionId are required.' });
    const staffCheck = await verifyRestaurantStaffRole(authUser.uid, idToken, restaurantId, ['owner', 'manager', 'cashier', 'captain']);
    if (!staffCheck.authorized) return res.status(staffCheck.code || 403).json({ success: false, error: staffCheck.error || 'FORBIDDEN', message: staffCheck.message || 'Closing table sessions is not authorized.' });
    if (!(await ensureServerAuthenticated())) return res.status(503).json({ success: false, error: 'SERVER_AUTH_UNAVAILABLE', message: 'Trusted table-session service is unavailable.' });
    const { tableSessionService } = await import('./src/services/tableSessionService');
    await tableSessionService.closeSession(restaurantId, sessionId, authUser.uid, req.body?.options);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Table-session close failed:', err);
    return res.status(400).json({ success: false, error: 'TABLE_SESSION_CLOSE_FAILED', message: err?.message || 'Failed to close table session.' });
  }
});

/**
 * Server-authoritative order completion/finalization endpoints.
 * Operational staff authenticate as themselves; the server performs the
 * business-rule checks and writes completion state under the trusted identity.
 */

/**
 * Trusted purchase receiving boundary. Browser clients request a receipt; the actual
 * inventory, movement, receiving-log and purchase-order transaction runs under the
 * trusted backend identity.
 */
app.post('/api/purchases/receive', async (req, res) => {
  try {
    const idToken = extractBearerToken(req);
    if (!idToken) return res.status(401).json({ success: false, error: 'UNAUTHENTICATED', message: 'Authentication token is required.' });
    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser?.uid) return res.status(401).json({ success: false, error: 'INVALID_AUTH_TOKEN', message: 'Invalid authentication token.' });

    const restaurantId = String(req.body?.restaurantId || '').trim();
    const data = req.body?.data;
    if (!restaurantId || !data || typeof data !== 'object') {
      return res.status(400).json({ success: false, error: 'MISSING_PARAMETERS', message: 'restaurantId and receiving data are required.' });
    }

    const staffCheck = await verifyRestaurantStaffRole(authUser.uid, idToken, restaurantId, ['owner', 'manager']);
    if (!staffCheck.authorized) {
      return res.status(staffCheck.code || 403).json({ success: false, error: staffCheck.error || 'FORBIDDEN', message: staffCheck.message || 'Only owners and managers may receive purchases.' });
    }
    if (!(await ensureServerAuthenticated())) {
      return res.status(503).json({ success: false, error: 'SERVER_AUTH_UNAVAILABLE', message: 'Trusted purchase service is unavailable.' });
    }

    const { purchaseOrderService } = await import('./src/services/purchaseOrderService');
    const rawClientRequestId = String(req.body?.clientRequestId || '').trim();
    const result = await purchaseOrderService.receiveGoods(restaurantId, data, rawClientRequestId ? `${authUser.uid}_${rawClientRequestId}` : undefined);
    return res.json({ success: true, result });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Purchase receiving failed:', err);
    return res.status(400).json({ success: false, error: 'PURCHASE_RECEIVING_FAILED', message: err?.message || 'Failed to receive purchase goods.' });
  }
});

app.post('/api/inventory/record-movement', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Bearer token required.' });
    const idToken = authHeader.substring(7).trim();
    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser?.uid) return res.status(401).json({ success: false, error: 'INVALID_AUTH_TOKEN', message: 'Invalid authentication token.' });

    const restaurantId = String(req.body?.restaurantId || '').trim();
    const data = req.body?.data;
    if (!restaurantId || !data || typeof data !== 'object') return res.status(400).json({ success: false, error: 'MISSING_PARAMETERS', message: 'restaurantId and movement data are required.' });

    const staffCheck = await verifyRestaurantStaffRole(authUser.uid, idToken, restaurantId, ['owner', 'manager']);
    if (!staffCheck.authorized) return res.status(staffCheck.code || 403).json({ success: false, error: staffCheck.error || 'FORBIDDEN', message: staffCheck.message || 'Inventory permission required.' });
    if (!(await ensureServerAuthenticated())) return res.status(503).json({ success: false, error: 'SERVER_AUTH_UNAVAILABLE', message: 'Trusted inventory service is unavailable.' });

    const { inventoryService } = await import('./src/services/inventoryService');
    const result = await inventoryService.recordStockMovement(restaurantId, data, authUser.uid);
    return res.json({ success: true, movement: result });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Stock movement failed:', err);
    return res.status(400).json({ success: false, error: 'STOCK_MOVEMENT_FAILED', message: err?.message || 'Failed to record stock movement.' });
  }
});

app.post('/api/orders/accept-online', async (req, res) => {
  try {
    const idToken = extractBearerToken(req);
    if (!idToken) return res.status(401).json({ success: false, error: 'UNAUTHENTICATED', message: 'Bearer authentication token is required.' });
    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser?.uid) return res.status(401).json({ success: false, error: 'INVALID_TOKEN', message: 'Authentication token is invalid or expired.' });
    const restaurantId = String(req.body?.restaurantId || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    const prepTimeMinutes = Number(req.body?.prepTimeMinutes ?? 20);
    if (!restaurantId || !orderId || !Number.isFinite(prepTimeMinutes) || prepTimeMinutes <= 0 || prepTimeMinutes > 1440) {
      return res.status(400).json({ success: false, error: 'INVALID_PARAMETERS', message: 'restaurantId, orderId and a valid prepTimeMinutes value are required.' });
    }
    const staffCheck = await verifyRestaurantStaffRole(authUser.uid, idToken, restaurantId, ['owner', 'manager', 'cashier', 'captain']);
    if (!staffCheck.authorized) return res.status(staffCheck.code || 403).json({ success: false, error: staffCheck.error || 'FORBIDDEN', message: staffCheck.message || 'Caller is not authorized to accept online orders.' });
    if (!(await ensureServerAuthenticated())) return res.status(503).json({ success: false, error: 'SERVER_AUTH_UNAVAILABLE', message: 'Trusted order service is unavailable.' });
    const { orderService } = await import('./src/services/orderService');
    const result = await orderService.acceptOnlineOrder(restaurantId, orderId, authUser.uid, Math.floor(prepTimeMinutes));
    return res.json({ success: true, order: result });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Online order acceptance failed:', err);
    return res.status(400).json({ success: false, error: 'ONLINE_ORDER_ACCEPT_FAILED', message: err?.message || 'Failed to accept online order.' });
  }
});

/**
 * Server-authoritative partial Order item cancellation.
 * Used by KOT cancellation synchronization and protected by caller-role checks.
 */
app.post('/api/orders/partial-cancel-items', async (req, res) => {
  try {
    const idToken = extractBearerToken(req);
    if (!idToken) return res.status(401).json({ success: false, error: 'UNAUTHENTICATED', message: 'Authentication token is required.' });

    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser?.uid) return res.status(401).json({ success: false, error: 'INVALID_TOKEN', message: 'Authentication token is invalid or expired.' });

    const restaurantId = String(req.body?.restaurantId || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    const itemCancellations = req.body?.itemCancellations;
    if (!restaurantId || !orderId || !Array.isArray(itemCancellations) || itemCancellations.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_PARAMETERS',
        message: 'restaurantId, orderId and itemCancellations are required.'
      });
    }

    const staffCheck = await verifyRestaurantStaffRole(
      authUser.uid,
      idToken,
      restaurantId,
      ['owner', 'manager', 'captain', 'kitchen']
    );
    if (!staffCheck.authorized) {
      return res.status(staffCheck.code || 403).json({
        success: false,
        error: staffCheck.error || 'FORBIDDEN',
        message: staffCheck.message || 'Caller is not authorized to partially cancel order items.'
      });
    }

    if (!(await ensureServerAuthenticated())) {
      return res.status(503).json({
        success: false,
        error: 'SERVER_AUTH_UNAVAILABLE',
        message: 'Trusted order cancellation service is unavailable.'
      });
    }

    const safeCancellations = itemCancellations
      .map((item: any) => ({
        itemId: String(item?.itemId || '').trim(),
        cancelledQuantity: Number(item?.cancelledQuantity),
        reason: typeof item?.reason === 'string' ? item.reason.trim() : undefined
      }))
      .filter((item: any) =>
        item.itemId &&
        Number.isInteger(item.cancelledQuantity) &&
        item.cancelledQuantity > 0
      );

    if (!safeCancellations.length) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_CANCELLATIONS',
        message: 'No valid item cancellations were provided.'
      });
    }

    const clientRequestId = String(req.body?.clientRequestId || '').trim();
    const { orderService } = await import('./src/services/orderService');
    const result = await orderService.partiallyCancelOrderItems(
      restaurantId,
      orderId,
      safeCancellations,
      authUser.uid,
      clientRequestId ? `${authUser.uid}_${clientRequestId}` : undefined
    );

    return res.json({ success: true, order: result });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Partial order item cancellation failed:', err);
    return res.status(400).json({
      success: false,
      error: 'ORDER_PARTIAL_CANCELLATION_FAILED',
      message: err?.message || 'Failed to partially cancel order items.'
    });
  }
});

app.post('/api/orders/complete', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Bearer token required.' });
    const idToken = authHeader.substring(7).trim();
    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser?.uid) return res.status(401).json({ success: false, error: 'INVALID_AUTH_TOKEN', message: 'Invalid authentication token.' });
    const restaurantId = String(req.body?.restaurantId || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    if (!restaurantId || !orderId) return res.status(400).json({ success: false, error: 'MISSING_PARAMETERS', message: 'restaurantId and orderId are required.' });

    const staffCheck = await verifyRestaurantStaffRole(authUser.uid, idToken, restaurantId, ['owner', 'manager', 'cashier', 'captain']);
    if (!staffCheck.authorized) return res.status(staffCheck.code || 403).json({ success: false, error: staffCheck.error || 'FORBIDDEN', message: staffCheck.message || 'Caller is not authorized to complete orders.' });
    if (!(await ensureServerAuthenticated())) return res.status(503).json({ success: false, error: 'SERVER_AUTH_UNAVAILABLE', message: 'Trusted order service is unavailable.' });

    const { orderService } = await import('./src/services/orderService');
    const result = await orderService.completeOrder(restaurantId, orderId, authUser.uid);
    return res.json({ success: true, order: result });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Order completion failed:', err);
    return res.status(400).json({ success: false, error: 'ORDER_COMPLETION_FAILED', message: err?.message || 'Failed to complete order.' });
  }
});

app.post('/api/orders/finalize', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Bearer token required.' });
    const idToken = authHeader.substring(7).trim();
    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser?.uid) return res.status(401).json({ success: false, error: 'INVALID_AUTH_TOKEN', message: 'Invalid authentication token.' });
    const restaurantId = String(req.body?.restaurantId || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    if (!restaurantId || !orderId) return res.status(400).json({ success: false, error: 'MISSING_PARAMETERS', message: 'restaurantId and orderId are required.' });

    const staffCheck = await verifyRestaurantStaffRole(authUser.uid, idToken, restaurantId, ['owner', 'manager', 'cashier', 'captain', 'kitchen']);
    if (!staffCheck.authorized) return res.status(staffCheck.code || 403).json({ success: false, error: staffCheck.error || 'FORBIDDEN', message: staffCheck.message || 'Caller is not authorized to finalize orders.' });
    if (!(await ensureServerAuthenticated())) return res.status(503).json({ success: false, error: 'SERVER_AUTH_UNAVAILABLE', message: 'Trusted order service is unavailable.' });

    const { orderFinalizationService } = await import('./src/services/orderFinalizationService');
    const result = await orderFinalizationService.evaluateAndFinalizeOrderAndSession(restaurantId, orderId, authUser.uid);
    return res.json({ success: true, result });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Order finalization failed:', err);
    return res.status(400).json({ success: false, error: 'ORDER_FINALIZATION_FAILED', message: err?.message || 'Failed to finalize order.' });
  }
});

/**
 * Server-authoritative stock consumption.
 * POS clients authenticate as themselves; the server verifies restaurant role,
 * then performs the inventory transaction under the trusted server identity.
 */

app.post('/api/stock/reverse-order', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Bearer token required.' });
    const idToken = authHeader.substring(7).trim();
    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser?.uid) return res.status(401).json({ success: false, error: 'INVALID_AUTH_TOKEN', message: 'Invalid authentication token.' });
    const restaurantId = String(req.body?.restaurantId || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    if (!restaurantId || !orderId) return res.status(400).json({ success: false, error: 'MISSING_PARAMETERS', message: 'restaurantId and orderId are required.' });
    const staffCheck = await verifyRestaurantStaffRole(authUser.uid, idToken, restaurantId, ['owner', 'manager']);
    if (!staffCheck.authorized) return res.status(staffCheck.code || 403).json({ success: false, error: 'FORBIDDEN', message: 'Only owner/manager may reverse order stock consumption.' });
    if (!(await ensureServerAuthenticated())) return res.status(503).json({ success: false, error: 'SERVER_AUTH_UNAVAILABLE', message: 'Trusted stock service is unavailable.' });
    const { stockConsumptionService } = await import('./src/services/stockConsumptionService');
    const result = await stockConsumptionService.reverseOrderStockConsumption(restaurantId, orderId, String(req.body?.reason || '').trim(), String(req.body?.clientRequestId || '').trim() || undefined, authUser.uid);
    return res.json({ success: true, result });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Stock reversal failed:', err);
    return res.status(400).json({ success: false, error: 'STOCK_REVERSAL_FAILED', message: err?.message || 'Failed to reverse stock consumption.' });
  }
});

app.post('/api/stock/reverse-partial', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Bearer token required.' });
    const idToken = authHeader.substring(7).trim();
    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser?.uid) return res.status(401).json({ success: false, error: 'INVALID_AUTH_TOKEN', message: 'Invalid authentication token.' });
    const restaurantId = String(req.body?.restaurantId || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    const cancelledItems = req.body?.cancelledItems;
    if (!restaurantId || !orderId || !Array.isArray(cancelledItems) || cancelledItems.length === 0) return res.status(400).json({ success: false, error: 'MISSING_PARAMETERS', message: 'restaurantId, orderId and cancelledItems are required.' });
    const staffCheck = await verifyRestaurantStaffRole(authUser.uid, idToken, restaurantId, ['owner', 'manager']);
    if (!staffCheck.authorized) return res.status(staffCheck.code || 403).json({ success: false, error: 'FORBIDDEN', message: 'Only owner/manager may reverse partial stock consumption.' });
    if (!(await ensureServerAuthenticated())) return res.status(503).json({ success: false, error: 'SERVER_AUTH_UNAVAILABLE', message: 'Trusted stock service is unavailable.' });
    const safeItems = cancelledItems.map((item: any) => ({ itemId: String(item?.itemId || '').trim(), cancelledQuantity: Number(item?.cancelledQuantity) })).filter((item: any) => item.itemId && Number.isFinite(item.cancelledQuantity) && item.cancelledQuantity > 0);
    if (!safeItems.length) return res.status(400).json({ success: false, error: 'INVALID_ITEMS', message: 'No valid cancelled items were provided.' });
    const { stockConsumptionService } = await import('./src/services/stockConsumptionService');
    const result = await stockConsumptionService.reversePartialStockConsumption(restaurantId, orderId, safeItems, String(req.body?.reason || '').trim() || undefined, authUser.uid, String(req.body?.clientRequestId || '').trim() || undefined);
    return res.json({ success: true, result });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Partial stock reversal failed:', err);
    return res.status(400).json({ success: false, error: 'PARTIAL_STOCK_REVERSAL_FAILED', message: err?.message || 'Failed to reverse partial stock consumption.' });
  }
});

app.post('/api/stock/consume-order', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Bearer authentication token is required.' });
    }
    const idToken = authHeader.substring(7).trim();
    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser?.uid) {
      return res.status(401).json({ success: false, error: 'INVALID_AUTH_TOKEN', message: 'Invalid or expired Firebase authentication token.' });
    }

    const restaurantId = String(req.body?.restaurantId || '').trim();
    const requested = req.body?.data;
    if (!restaurantId || !requested?.orderId) {
      return res.status(400).json({ success: false, error: 'MISSING_PARAMETERS', message: 'restaurantId and orderId are required.' });
    }
    const orderId = String(requested.orderId).trim();

    const staffCheck = await verifyRestaurantStaffRole(
      authUser.uid,
      idToken,
      restaurantId,
      ['owner', 'manager', 'cashier', 'captain']
    );
    if (!staffCheck.authorized) {
      return res.status(staffCheck.code || 403).json({
        success: false,
        error: staffCheck.error || 'FORBIDDEN',
        message: staffCheck.message || 'Caller is not authorized to consume restaurant stock.'
      });
    }

    if (!(await ensureServerAuthenticated())) {
      return res.status(503).json({ success: false, error: 'SERVER_AUTH_UNAVAILABLE', message: 'Trusted stock-processing service is unavailable.' });
    }

    const orderRef = doc(db, 'restaurants', restaurantId, 'orders', orderId);
    const orderSnap = await getDoc(orderRef);
    if (!orderSnap.exists()) {
      return res.status(404).json({ success: false, error: 'ORDER_NOT_FOUND', message: 'Order does not exist in the requested restaurant.' });
    }
    const order = orderSnap.data() as any;
    if (order.restaurantId !== restaurantId) {
      return res.status(403).json({ success: false, error: 'TENANT_MISMATCH', message: 'Order does not belong to this restaurant.' });
    }
    if (order.status === 'cancelled') {
      return res.status(409).json({ success: false, error: 'ORDER_CANCELLED', message: 'Cancelled orders cannot consume stock.' });
    }
    const authoritativeData = {
      orderId,
      orderNumber: String(order.orderNumber || orderId),
      items: Array.isArray(order.items)
        ? order.items.map((item: any) => ({
            itemId: String(item.itemId || '').trim(),
            quantity: Number(item.quantity),
            nameSnapshot: String(item.nameSnapshot || '')
          })).filter((item: any) => item.itemId && Number.isFinite(item.quantity) && item.quantity > 0)
        : [],
      clientRequestId: typeof requested.clientRequestId === 'string' ? requested.clientRequestId.trim() : undefined
    };

    try {
      const result = await stockConsumptionService.consumeStockForOrder(restaurantId, authoritativeData);
      const serverUid = auth.currentUser?.uid || 'system';
      await updateDoc(orderRef, {
        stockConsumptionStatus: result.consumptions.length ? 'consumed' : 'not_applicable',
        stockConsumptionError: null,
        updatedBy: serverUid,
        updatedAt: serverTimestamp()
      });
      return res.json({ success: true, result });
    } catch (err: any) {
      try {
        const serverUid = auth.currentUser?.uid || 'system';
        await updateDoc(orderRef, {
          stockConsumptionStatus: 'failed',
          stockConsumptionError: String(err?.message || 'Stock consumption failed.'),
          updatedBy: serverUid,
          updatedAt: serverTimestamp()
        });
      } catch (statusErr) {
        console.warn('[RestaurantOS Server] Could not persist stock consumption failure state:', statusErr);
      }
      throw err;
    }
  } catch (err: any) {
    console.error('[RestaurantOS Server] Stock consumption request failed:', err);
    return res.status(400).json({
      success: false,
      error: 'STOCK_CONSUMPTION_FAILED',
      message: err?.message || 'Failed to consume stock for order.'
    });
  }
});

/**
 * Server-authoritative initial trial provisioning.
 * Only an authenticated restaurant owner can create the one-time trial document.
 */
app.post('/api/subscription/ensure-trial', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Bearer authentication token is required.' });
    }
    const idToken = authHeader.substring(7).trim();
    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser?.uid) {
      return res.status(401).json({ success: false, error: 'INVALID_AUTH_TOKEN', message: 'Invalid or expired Firebase authentication token.' });
    }
    const restaurantId = String(req.body?.restaurantId || '').trim();
    if (!restaurantId) {
      return res.status(400).json({ success: false, error: 'MISSING_PARAMETERS', message: 'restaurantId is required.' });
    }

    const ownerCheck = await verifyRestaurantOwnerForSubscription(authUser.uid, idToken, restaurantId);
    if (!ownerCheck.authorized) {
      return res.status(ownerCheck.code || 403).json({
        success: false,
        error: ownerCheck.error || 'FORBIDDEN',
        message: ownerCheck.message || 'Only the restaurant owner can initialize the trial.'
      });
    }

    const subscription = await ensureRestaurantTrialInFirestore(restaurantId);
    return res.json({ success: true, subscription });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Trial initialization failed:', err);
    return res.status(500).json({
      success: false,
      error: 'TRIAL_INITIALIZATION_FAILED',
      message: err?.message || 'Failed to initialize restaurant trial.'
    });
  }
});

/**
 * Authoritative Server-Side Razorpay Order Creation
 * Computes price server-side in paise (INR) based on centralized plan catalog.
 * Validates plan legitimacy and enforces restaurant ownership.
 */
app.post('/api/subscription/create-order', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Bearer authentication token is required.'
      });
    }

    const idToken = authHeader.substring(7).trim();
    if (!idToken) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Empty Bearer authentication token.'
      });
    }

    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser || !authUser.uid) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_AUTH_TOKEN',
        message: 'Invalid or expired Firebase authentication token.'
      });
    }

    const {
      restaurantId,
      planId,
      billingCycle = 'monthly',
      customerEmail,
      customerName,
      amount
    } = req.body;

    if (!restaurantId || !planId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_PARAMETERS',
        message: 'restaurantId and planId are required.'
      });
    }

    const cleanRestaurantId = String(restaurantId).trim();
    const cleanPlanId = String(planId).trim();

    // Validate plan
    const planValidation = validateSelfServePlan(cleanPlanId);
    if (!planValidation.valid) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PLAN',
        message: planValidation.error
      });
    }

    // Reject arbitrary client amount manipulation if passed
    const targetPlan = getPlanById(cleanPlanId);
    const expectedAmount =
      billingCycle === 'annual' ? targetPlan.priceAnnualPaise : targetPlan.priceMonthlyPaise;
    if (amount !== undefined && Number(amount) !== expectedAmount) {
      return res.status(400).json({
        success: false,
        error: 'PRICE_MISMATCH',
        message: `Amount ${amount} does not match authoritative plan price ${expectedAmount}. Price manipulation is rejected.`
      });
    }

    // Verify restaurant ownership
    const ownerCheck = await verifyRestaurantOwnerForSubscription(
      authUser.uid,
      idToken,
      cleanRestaurantId
    );
    if (!ownerCheck.authorized) {
      return res.status(ownerCheck.code || 403).json({
        success: false,
        error: ownerCheck.error || 'FORBIDDEN',
        message: ownerCheck.message || 'Only restaurant owners can purchase subscriptions.'
      });
    }

    const order = await createRazorpayOrder({
      restaurantId: cleanRestaurantId,
      planId: cleanPlanId,
      billingCycle,
      customerEmail: customerEmail || authUser.email,
      customerName,
      callerUid: authUser.uid
    });

    return res.json({
      success: true,
      orderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      keyId: order.keyId,
      planId: order.planId,
      planName: order.planName,
      billingCycle: order.billingCycle
    });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Razorpay order creation error:', err);
    return res.status(400).json({
      success: false,
      error: 'ORDER_CREATION_FAILED',
      message: err?.message || 'Failed to create subscription order.'
    });
  }
});

/**
 * Authoritative Server-Side Subscription Verification and Activation
 *
 * Verifies Razorpay payment signatures with HMAC SHA-256, validates plan
 * configurations and pricing, checks restaurant ownership, activates
 * subscription in Firestore, and records audit history.
 */
app.post('/api/subscription/verify-and-activate', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Bearer authentication token is required.'
      });
    }

    const idToken = authHeader.substring(7).trim();
    if (!idToken) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Empty Bearer authentication token.'
      });
    }

    const authUser = await verifyFirebaseToken(idToken);
    if (!authUser || !authUser.uid) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_AUTH_TOKEN',
        message: 'Invalid or expired Firebase authentication token.'
      });
    }

    const {
      restaurantId,
      planId,
      billingCycle = 'monthly',
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      providerOrderId,
      paymentId,
      signature,
      paymentReference,
      amount,
      currency
    } = req.body;

    const cleanRestaurantId = String(restaurantId || '').trim();
    const cleanPlanId = String(planId || '').trim();

    if (!cleanRestaurantId || !cleanPlanId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_PARAMETERS',
        message: 'restaurantId and planId are required.'
      });
    }

    // Validate plan
    const planValidation = validateSelfServePlan(cleanPlanId);
    if (!planValidation.valid) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PLAN',
        message: planValidation.error
      });
    }

    // Verify restaurant ownership
    const ownerCheck = await verifyRestaurantOwnerForSubscription(
      authUser.uid,
      idToken,
      cleanRestaurantId
    );
    if (!ownerCheck.authorized) {
      return res.status(ownerCheck.code || 403).json({
        success: false,
        error: ownerCheck.error || 'FORBIDDEN',
        message: ownerCheck.message || 'Only restaurant owners can activate subscriptions.'
      });
    }

    const orderId = razorpayOrderId || providerOrderId || paymentReference;
    const payId = razorpayPaymentId || paymentId || paymentReference;
    const sig = razorpaySignature || signature;

    if (!orderId || !payId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_PAYMENT_DETAILS',
        message: 'Razorpay orderId and paymentId are required for verification.'
      });
    }

    const targetPlan = getPlanById(cleanPlanId);
    const expectedAmount =
      billingCycle === 'annual' ? targetPlan.priceAnnualPaise : targetPlan.priceMonthlyPaise;

    // Reject arbitrary client amount manipulation
    if (amount !== undefined && Number(amount) !== expectedAmount) {
      return res.status(400).json({
        success: false,
        error: 'PRICE_MISMATCH',
        message: `Amount ${amount} does not match authoritative price ${expectedAmount} for plan ${cleanPlanId}. Client-side price tampering is rejected.`
      });
    }

    // Cryptographic signature verification
    const isSignatureValid = verifyRazorpayPaymentSignature({
      razorpayOrderId: orderId,
      razorpayPaymentId: payId,
      razorpaySignature: sig || ''
    });

    if (!isSignatureValid) {
      // Record payment failure audit log
      await recordSubscriptionAudit({
        restaurantId: cleanRestaurantId,
        eventType: 'PAYMENT_FAILED',
        planId: targetPlan.planId,
        planName: targetPlan.name,
        billingCycle,
        amount: expectedAmount,
        currency: currency || 'INR',
        status: 'failed',
        razorpayOrderId: orderId,
        razorpayPaymentId: payId,
        paymentReference: payId,
        metadata: {
          failureReason: 'INVALID_SIGNATURE',
          callerUid: authUser.uid
        }
      }).catch(() => {});

      return res.status(400).json({
        success: false,
        error: 'INVALID_SIGNATURE',
        message: 'Razorpay payment signature verification failed. The transaction cannot be verified.'
      });
    }

    // Signature alone is not sufficient: verify the payment/order against Razorpay's
    // authoritative API so a valid payment from another order/restaurant cannot be replayed.
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!razorpayKeyId || !razorpayKeySecret) {
      return res.status(503).json({ success: false, error: 'PAYMENT_PROVIDER_NOT_CONFIGURED' });
    }
    const basicAuth = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString('base64');
    const [orderResponse, paymentResponse] = await Promise.all([
      fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, {
        headers: { Authorization: `Basic ${basicAuth}` }
      }),
      fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(payId)}`, {
        headers: { Authorization: `Basic ${basicAuth}` }
      })
    ]);
    if (!orderResponse.ok || !paymentResponse.ok) {
      return res.status(400).json({ success: false, error: 'PAYMENT_NOT_FOUND', message: 'Razorpay could not confirm the supplied transaction.' });
    }
    const razorpayOrder = await orderResponse.json();
    const razorpayPayment = await paymentResponse.json();
    const expectedCurrency = 'INR';
    if (
      razorpayOrder.id !== orderId ||
      Number(razorpayOrder.amount) !== expectedAmount ||
      razorpayOrder.currency !== expectedCurrency ||
      razorpayPayment.id !== payId ||
      razorpayPayment.order_id !== orderId ||
      Number(razorpayPayment.amount) !== expectedAmount ||
      razorpayPayment.currency !== expectedCurrency ||
      !['captured', 'authorized'].includes(String(razorpayPayment.status).toLowerCase())
    ) {
      return res.status(400).json({ success: false, error: 'PAYMENT_DETAILS_MISMATCH', message: 'Razorpay transaction details do not match the selected subscription.' });
    }
    const notes = razorpayOrder.notes || {};
    if (notes.restaurantId && String(notes.restaurantId) !== cleanRestaurantId) {
      return res.status(400).json({ success: false, error: 'PAYMENT_RESTAURANT_MISMATCH' });
    }
    if (notes.planId && String(notes.planId) !== cleanPlanId) {
      return res.status(400).json({ success: false, error: 'PAYMENT_PLAN_MISMATCH' });
    }

    // Authoritative subscription activation in Firestore
    const updatedSub = await activateSubscriptionInFirestore({
      restaurantId: cleanRestaurantId,
      planId: targetPlan.planId,
      billingCycle,
      razorpayOrderId: orderId,
      razorpayPaymentId: payId,
      idToken
    });

    return res.json({
      success: true,
      verified: true,
      subscription: updatedSub,
      data: updatedSub
    });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Subscription verification error:', err);
    return res.status(500).json({
      success: false,
      error: 'SUBSCRIPTION_VERIFICATION_ERROR',
      message: err?.message || 'Failed to verify and activate subscription.'
    });
  }
});

/**
 * Razorpay Webhook Endpoint
 * Handles asynchronous server-to-server lifecycle notifications:
 * - payment.captured / order.paid -> activates/renews subscription
 * - payment.failed -> logs failure audit
 * - subscription.charged -> renews billing period
 * - subscription.cancelled -> marks subscription expired
 */
app.post('/api/subscription/razorpay-webhook', async (req: any, res) => {
  try {
    const signature = (req.headers['x-razorpay-signature'] as string) || '';
    const rawBody = req.rawBody || JSON.stringify(req.body);

    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(503).json({ success: false, error: 'WEBHOOK_NOT_CONFIGURED' });
    }
    if (webhookSecret) {
      if (!signature) {
        console.warn('[RestaurantOS Server] Webhook rejected: missing x-razorpay-signature header');
        return res.status(400).json({ success: false, error: 'MISSING_WEBHOOK_SIGNATURE' });
      }
      const isValid = verifyRazorpayWebhookSignature(rawBody, signature);
      if (!isValid) {
        console.warn('[RestaurantOS Server] Webhook rejected: invalid signature');
        return res.status(400).json({ success: false, error: 'INVALID_WEBHOOK_SIGNATURE' });
      }
    }

    const eventId = String(
      (req.headers['x-razorpay-event-id'] as string) || req.body?.event_id || ''
    ).trim();
    if (!eventId) {
      return res.status(400).json({ success: false, error: 'MISSING_WEBHOOK_EVENT_ID' });
    }

    const result = await processRazorpayWebhookPayload(req.body, eventId);
    return res.status(200).json({ received: true, ...result });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Webhook processing error:', err);
    return res.status(500).json({ error: 'WEBHOOK_PROCESSING_ERROR', message: err?.message });
  }
});

// Fallback 404 handler for API routes (ensures unmatched /api/* requests never fall through to SPA HTML)
app.use('/api/*', (_req, res) => {
  res.status(404).json({
    success: false,
    error: 'API_ENDPOINT_NOT_FOUND',
    message: 'The requested API endpoint does not exist.'
  });
});

let activeServer: any = null;

// Start Express + Vite middleware server
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.ENABLE_HMR === 'true' ? { overlay: true } : false,
        watch: {
          ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
        },
      },
      appType: 'spa'
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', async (req, res) => {
      const indexPath = path.join(distPath, 'index.html');
      try {
        const rawHtml = fs.readFileSync(indexPath, 'utf-8');
        const html = await injectPublicRestaurantMeta(req, rawHtml);
        res.set('Content-Type', 'text/html');
        res.send(html);
      } catch (err) {
        // Fall back to the untouched build output if anything above fails, so SEO
        // injection can never break page delivery.
        res.sendFile(indexPath);
      }
    });
  }

  if (process.env.NODE_ENV === 'production') {
    try { requireProductionSecrets(); } catch (startupError) {
      console.error('[RestaurantOS Server] Startup security check failed:', startupError);
      process.exit(1);
    }
  }

  if (process.env.NODE_ENV === 'production') {
    // Firebase Admin SDK is the authoritative server identity for privileged
    // Firestore operations. Auth-user/claim provisioning must never prevent
    // Cloud Run from opening its HTTP listener. Endpoint-level authorization
    // still verifies the caller before every privileged mutation.
    await ensureServerAuthenticated().catch((err) => {
      console.warn('[RestaurantOS Server] Server identity preparation skipped; continuing with Admin SDK:', err?.message || err);
    });
  }

  activeServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[RestaurantOS Server] Server running on http://0.0.0.0:${PORT}`);
  });

  activeServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[RestaurantOS Server] Fatal Error: Port ${PORT} is already bound by another process.`);
      process.exit(1);
    } else {
      console.error('[RestaurantOS Server] Server error:', err);
    }
  });
}

function handleShutdown(signal: string) {
  if (activeServer) {
    console.log(`[RestaurantOS Server] Received ${signal}, closing HTTP server listener...`);
    activeServer.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 1500);
  } else {
    process.exit(0);
  }
}

process.once('SIGTERM', () => handleShutdown('SIGTERM'));
process.once('SIGINT', () => handleShutdown('SIGINT'));

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer().catch((error) => {
    console.error('[RestaurantOS Server] Fatal startup error:', error);
    process.exit(1);
  });
}

export { app };
