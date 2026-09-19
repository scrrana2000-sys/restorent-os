# RestaurantOS Release Verification

This release is based on the current uploaded project and preserves the source/configuration tree while applying the production hardening and Firestore contract fixes.

## Verified in the available sandbox
- Security static audit: PASS
- Firestore contract audit: PASS
- Release static gate: PASS
- TypeScript/TSX syntax parse: PASS (0 parse errors)
- JSON configuration validation: PASS
- GitHub Actions YAML validation: PASS
- npm lockfile dry-run: PASS
- ZIP integrity test: PASS

## Firestore database binding
The Firebase app uses the named Firestore database from `firebase-applet-config.json`, and `firebase.json` explicitly binds `firestore.rules` and `firestore.indexes.json` to the same database ID. This prevents a future CLI deployment from accidentally targeting `(default)` while the application is connected to the named AI Studio database.

## Build verification limitation
A complete network-backed `npm ci` could not be completed in the sandbox because the registry/network request timed out and the local npm cache was incomplete. Therefore a fresh `npm test` and `npm run build` execution was not certified here. The CI workflow keeps installation, type-check, tests, and production build as mandatory deployment gates.

## Production configuration
Cloud Run production requires the documented Secret Manager values and exact HTTPS origins. Local development uses the `.env.example` defaults and does not require production payment/email secrets merely to start.
