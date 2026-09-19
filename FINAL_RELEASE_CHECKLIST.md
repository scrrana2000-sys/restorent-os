# RestaurantOS Final Release Checklist

## Release candidate state
- Multi-tenant Firestore invariants hardened.
- Staff member roles/status cannot be self-escalated.
- Orders and KOTs are created through authenticated server APIs.
- Payment settlement and inventory ledger writes use controlled transactional/server paths.
- Subscription current/history documents are server-write only.
- Razorpay checkout amount is computed from server plan configuration.
- Razorpay webhook signature is mandatory; failed webhook events are retryable and stale processing claims expire after 10 minutes.
- Guest order/bill access uses high-entropy server-issued tracking tokens.
- CI verifies security audit, TypeScript, tests, and production build before Cloud Run deployment.
- Pages deployment consumes only the verified API workflow revision and `dist/`.
- Production runtime requires explicit HTTPS origins and production secrets; startup fails closed when trusted server authentication cannot be established.

## Verification performed in this archive
- Security audit: PASS (all checks).
- Firestore/storage rule delimiter check: PASS.
- Workflow YAML parse: PASS.
- Node syntax check for modified server TypeScript: PASS.
- Targeted TypeScript compiler parse produced no syntax diagnostics; dependency/module errors remain because dependencies are not installed in the sandbox.

## Required external release gate
Run `npm ci` and then `npm run verify` in CI/Cloud Build. Do not deploy if any verification step fails.

## Required production configuration
- `SYSTEM_SERVER_PASSWORD` (32+ characters, secret-managed)
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `PUBLIC_APP_URL` (HTTPS)
- `ALLOWED_ORIGINS` (exact HTTPS origins)
- GitHub secret `VITE_API_BASE_URL` pointing only to the production HTTPS API
