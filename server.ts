import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { auth } from './src/config/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { submitCustomerOnlineOrder } from './src/services/customerCheckoutService';
import {
  verifyFirebaseToken,
  verifyRestaurantStaffAuthorization,
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
  recordSubscriptionAudit,
  validateSelfServePlan
} from './src/server/razorpayService';
import { getPlanById } from './src/config/subscriptionPlans';

const app = express();
const PORT = 3000;

app.use(
  express.json({
    limit: '50kb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

// Permissive CORS middleware with support for GitHub Pages and Cloud Run previews
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    const isAllowed =
      origin === 'https://scrrana2000-sys.github.io' ||
      origin.includes('github.io') ||
      origin.endsWith('.run.app') ||
      origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:');

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With, X-Razorpay-Signature, X-Razorpay-Event-Id'
      );
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'restaurantos-api'
  });
});

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
  return { allowed: true };
}

/**
 * Trusted server-side online order submission boundary.
 * Authoritatively validates order inputs and processes the submission securely.
 */
app.post('/api/submit-online-order', async (req, res) => {
  try {
    const rawIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown-ip';
    const clientIp = rawIp.split(',')[0].trim();

    const rateCheck = checkOnlineOrderIpLimit(clientIp);
    if (!rateCheck.allowed) {
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

    await ensureServerAuthenticated();

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

    const result = await submitCustomerOnlineOrder({
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
      customerId: effectiveCustomerId,
      customerEmail: effectiveCustomerEmail
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
  return res.json({
    success: true,
    keyId: getPublicRazorpayKeyId(),
    currency: 'INR'
  });
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

    const eventId =
      (req.headers['x-razorpay-event-id'] as string) ||
      req.body?.event_id ||
      (req.body?.payload?.payment?.entity?.id
        ? `${req.body.payload.payment.entity.id}_${req.body.event}`
        : `event_${Date.now()}`);

    const result = await processRazorpayWebhookPayload(req.body, eventId);
    return res.status(200).json({ received: true, ...result });
  } catch (err: any) {
    console.error('[RestaurantOS Server] Webhook processing error:', err);
    return res.status(500).json({ error: 'WEBHOOK_PROCESSING_ERROR', message: err?.message });
  }
});

// Start Express + Vite middleware server
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.ENABLE_HMR === 'true',
      },
      appType: 'spa'
    });

    // Seamlessly support both root (/) and base subpath (/restorent-os/) in dev without 302 redirects
    app.use((req, res, next) => {
      if (req.url.startsWith('/restorent-os/')) {
        req.url = req.url.slice('/restorent-os'.length) || '/';
      } else if (req.url === '/restorent-os') {
        req.url = '/';
      }
      next();
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use('/restorent-os', express.static(distPath));
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[RestaurantOS Server] Server running on http://0.0.0.0:${PORT}`);
    ensureServerAuthenticated().catch((err) => {
      console.warn('[RestaurantOS Server] Background system server auth notice:', err?.message || err);
    });
  });
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer();
}

export { app };
