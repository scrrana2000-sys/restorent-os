# RestaurantOS Production Hardening Status

The production-candidate build secures Firestore authorization, POS financial integrity, online checkout authority, payments, inventory, idempotency, invitations, CORS, webhook validation/retry behavior, CI, and deployment packaging.

Required production environment: `NODE_ENV=production`, `PUBLIC_APP_URL`, `ALLOWED_ORIGINS`, a 32+ character `SYSTEM_SERVER_PASSWORD`, and production Razorpay credentials (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`).

`npm run verify` runs the static security gate, TypeScript check, full Vitest suite, and web/server build. GitHub Pages publishes only `dist/`; the server bundle is emitted to `dist-server/`. Docker builds both artifacts for Cloud Run. Orders and KOTs are created through trusted API boundaries; subscription and stock-ledger state remains server-authoritative.

The current sandbox could not complete a fresh dependency installation because npm package downloads are unavailable/time out in this execution environment. Static security/rule/workflow checks and source syntax checks pass; CI/Cloud Build remains the required executable release gate for dependency-backed tests and builds.
