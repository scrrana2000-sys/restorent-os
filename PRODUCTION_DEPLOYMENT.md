# RestaurantOS Production Deployment

## GitHub Actions → Cloud Run

The repository now separates web and API deployments. GitHub Pages publishes only `dist/`; the Cloud Run workflow builds the checked-in Dockerfile and deploys `server.ts` as the API service.

Configure these GitHub Actions secrets/variables before enabling automatic production deployment:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`
- `GCP_PROJECT_ID`
- `GCP_REGION`
- `CLOUD_RUN_SERVICE`
- `PUBLIC_APP_URL`
- `ALLOWED_ORIGINS`

Create the following Secret Manager secrets in the target Google Cloud project:

- `SYSTEM_SERVER_PASSWORD` (random, at least 32 characters)
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

The GitHub OIDC service account should be granted the minimum roles required to build/deploy Cloud Run and read the referenced Secret Manager versions. Do not put payment secrets into repository files.

After deployment, the workflow checks `/api/health` and fails the deployment job if the live service is unavailable.
