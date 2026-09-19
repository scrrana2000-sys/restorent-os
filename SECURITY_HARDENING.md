# RestaurantOS Security Hardening

Applied source-level hardening for the September 18, 2026 audit findings.

- Member self-updates are profile-field-only; role/status escalation is blocked.
- Guest online orders and public KOT documents are no longer directly readable.
- Subscription current state/history are server-only writes.
- Inventory master data, stock movements and stock consumptions are owner/manager/server controlled.
- Public restaurant writes enforce tenant IDs.
- Razorpay placeholders and production payment simulation are removed; payment verification checks authoritative Razorpay order/payment details.
- Webhooks fail closed when the webhook secret is missing.
- Online checkout resolves authoritative menu price, tax, variants and add-ons on the trusted path.
- Subscription API uses the centralized API URL resolver.
- CORS is exact-origin allowlist based.
- CI uses npm ci, tests, type-check and build before deployment.
- Production Pages no longer targets the AI Studio development Cloud Run URL.
- Storage alternate-database and rest_init ownership bypasses are removed.
- Rate-limit reset bug is fixed.

- Order creation and KOT creation are server-authoritative; staff clients use authenticated API endpoints instead of direct Firestore creates.
- POS order API accepts only supported staff order sources and non-online order types.
- Order stock locks are server-only mutable state; reversal is performed through the trusted stock APIs.
- Webhook idempotency now retries failed deliveries and reclaims stale processing leases after 10 minutes, preventing a crashed worker from permanently suppressing Razorpay retries.
- Webhook event failures are persisted as `failed` before the API returns, while processed/ignored events remain idempotently terminal.

## Verification limitation
Dependencies were not present in the supplied archive and `npm ci` timed out in the execution environment, so a fresh dependency-backed test/build verification could not be completed here. The CI workflow now enforces those checks on deployment.
