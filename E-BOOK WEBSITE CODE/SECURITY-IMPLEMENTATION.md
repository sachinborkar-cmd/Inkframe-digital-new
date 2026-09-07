# Authentication and access changes

The existing Express, MySQL, session, bcrypt, Nodemailer and vanilla JavaScript architecture is retained. Email OTP and Google sign-in remain available. Password sign-in and password recovery are additional options.

## Migrations and existing records

`server/schema.js` runs the additive, repeatable `server/security-schema.js` migration on startup. It adds user roles (`CUSTOMER`, `ADMIN`), owner/access flags, optional password hashes and a session version. OTP records gain a purpose with existing codes classified as `SIGN_IN`. New tables store hashed reset grants, database rate-limit counters and migration markers. Orders gain verification time and gateway reference fields; `failed` is added to the existing status enum.

The one-time `database-admin-roles-v1` migration preserves already verified accounts on the existing admin list and an already verified configured owner. It does not grant access to addresses that register later. All subsequent authorization reads the database role, not an email environment variable or session admin flag. Fresh installations can explicitly provision an existing verified account with `node server/provision-owner.js VERIFIED_USER_ID`. Run this only as an authorized database operator. Owners can grant roles to existing verified, active customers in Admin access.

Existing users, products, files and orders are preserved. No old paid flag is automatically promoted to a verified payment. Unverified legacy paid orders remain recorded, but are excluded from revenue and cannot unlock downloads or trigger resends. Before granting those orders access, reconcile their gateway identifiers, amount, currency, ownership and final payment status with the selected gateway. Do not bulk-fill `verified_at` based on the existing paid flag. Gateway reconciliation is still pending gateway selection.

## API access audit

| Routes | Access and enforcement |
| --- | --- |
| `GET /api/auth/session`, `GET /api/auth/google-config` | Public; exposes only safe session/configuration data. Session validity is checked against the current user. |
| `POST /api/auth/send-otp`, `/verify-otp`, `/google` | Public authentication endpoints; OTP purpose, attempt controls, session binding or Google token/nonce verification. |
| `POST /api/auth/login` | Public; password comparison, account validation, IP/email limits and session rotation. |
| `POST /api/auth/forgot-password` | Public; generic response, email/IP limits and resend cooldown. |
| `POST /api/auth/verify-reset-otp` | Public; email/purpose/expiry checks and serialized five-attempt limit; creates a restricted reset session. |
| `POST /api/auth/reset-password` | Restricted reset session; one-use database grant, password validation and session invalidation. |
| `POST /api/auth/logout` | Current session only; destroys it. |
| `GET /api/store/products`, `POST /api/store/coupon` | Public catalogue and read-only coupon validation. Private file paths are excluded. |
| `GET /api/payments/config` | Public; safe enabled/disabled flags only. |
| `GET/PUT /api/store/cart` | Authenticated active, verified customer; session user determines ownership. |
| `POST /api/store/orders` | Authenticated; returns 503 without writing orders or consuming coupons until live payment initialization is integrated. |
| `/api/profile` GET/POST/PUT | Authenticated; reads/writes only the session user's profile. Client user IDs are ignored. |
| `GET /api/library`, `GET /api/library/:slug/download` | Authenticated; ownership and paid verification checked on the server. No private storage paths in responses. |
| `/api/test-checkout` POST, `/:id` GET, `/:id/retry-email` POST | Authenticated owner of the order; all routes disabled in production or unless `TEST_PAYMENTS_ENABLED=true`. Test-only idempotent checkout, with throttled delivery retry. |
| `/api/admin/me`, `/dashboard`, `/products`, `/categories`, `/coupons`, `/uploads`, `/orders`, `/customers`, `/settings`, `/activity` | Admin only on every method; database-backed active user and role checks. All mutations require the existing session CSRF token. |
| `PUT /api/admin/customers/:id/access` | Admin only; can suspend/restore customer accounts, never admin accounts. Invalidates existing sessions. |
| `GET /api/admin/analytics` | Admin only; database sales, monthly totals, bestsellers and recent orders. |
| `/api/admin/team` and invitations | Owner only, plus admin mutation CSRF. Roles granted only to existing verified accounts. Invitations are throttled. |
| Payment webhook | Not implemented: no gateway is integrated or selected. No unsigned webhook or client-success endpoint grants access. |

Public HTML pages remain browsable without signing in. Library/cart/admin route checks and frontend redirects complement API authorization. Existing origin checks reject cross-origin browser writes. Errors do not include database queries, stack traces or credentials.

## Password recovery

Reset OTPs use cryptographic randomness, bcrypt hashes, a ten-minute lifetime, a separate `PASSWORD_RESET` purpose, and at most five verification attempts. Verification locks the user and OTP rows so concurrent guesses cannot bypass the limit. Email and IP limits persist across process restarts. Resends invalidate earlier reset codes.

Successful verification consumes the OTP and creates a ten-minute, random 256-bit grant whose database value is SHA-256 hashed. The corresponding token stays in the server-side session. Completing the reset consumes the grant, invalidates other OTPs/grants, saves a bcrypt cost-12 hash, increments the session version, destroys the reset session and returns to sign-in. New passwords require at least 12 characters and at most 72 UTF-8 bytes. Existing OTP/Google-only customers can set a password through the same verified flow.

Recovery requests return the same response for registered, absent and email-throttled addresses. SMTP delivery runs after the response so mail delivery latency does not identify accounts. SMTP failures invalidate the undelivered code and produce a generic operational log. This is not a durable mail queue; a process shutdown during sending can require the customer to request another code.

These controls follow the [OWASP password recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## Digital files and payments

Private PDF access requires the session user to own an order whose state is paid and whose payment has backend verification evidence. Development test orders are a separate exception only when explicit test mode is enabled outside production. Pending, failed, cancelled and refunded orders do not grant access.

Public uploaded PDFs must be attached as a sample to a published product. Sample fingerprints are compared with configured private paid PDFs; an identical copy is blocked from public delivery and hidden from the public catalogue. Encoded file extensions pass through the same check. Admin saving rejects full-paid-file copies as samples. Existing copies are preserved on disk. The audit found one such existing sample; replace it with a separate excerpt in the product editor.

**Live payment integration is outstanding.** The project contains no real gateway. Live checkout remains disabled, and the previous pending-order endpoint no longer consumes coupons without payment. Gateway order creation, signature/status verification, webhook authentication, capture/refund event processing, and live-payment idempotency must be implemented after a provider is selected. The new reference fields alone are not payment verification. No successful live payment or webhook test is claimed.

## Verification and setup

- `npm run check`: existing JavaScript syntax checks. New/modified backend and frontend modules were also checked with `node --check`.
- `npm run test:security`: database-backed password/reset, generic responses, hash storage, expiry, concurrent attempts, single use, session revocation, OTP sign-in, role checks, customer isolation, disabled accounts and analytics tests.
- `npm run test:admin`: admin CRUD/CSRF/role and delivery controls, product landing content, category/coupon operations, test checkout and access revocation.
- `npm run test:checkout`: explicit development test payments, retry idempotency, mocked email failure/retry, protected downloads and profile ownership.
- `npm run test:product`: customer rendering, purchase links, previews, escaped quotes and unavailable products.
- `npm run test:http`: against a running server at `TEST_HTTP_ORIGIN` (default `http://localhost:8011`), public pages, protected APIs, file restrictions and cross-origin rejection. It creates and removes one temporary public-upload fixture.

SMTP is mocked in integration tests; real mailbox delivery and Google OAuth need manual checks with configured accounts. Browser layout testing is also outstanding. Express serves both backend and frontend; there is no separate frontend build or TypeScript compiler.

Keep the existing `.env` private and excluded from Git. `.env.example` contains no account credentials and disables test payments by default. Production requires a strong `SESSION_SECRET`, MySQL configuration, SMTP credentials, correct HTTPS `APP_ORIGIN`, and (if used) `GOOGLE_CLIENT_ID`. Payment secrets/webhook URLs have deliberately not been invented before a gateway is selected.
