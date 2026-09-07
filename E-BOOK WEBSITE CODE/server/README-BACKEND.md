# Inkframe MySQL + Express backend

The existing Inkframe storefront is served by Express. Authentication uses email OTPs sent through Gmail SMTP, bcrypt-hashed OTP records in MySQL, and server-side sessions stored in MySQL.

## 1. Requirements

- Node.js 20 or newer
- MySQL 8 or newer
- A Gmail account with 2-Step Verification enabled

## 2. Install packages

Open PowerShell in the project directory and run:

```powershell
npm install
```

## 3. Create the MySQL database

Import the included schema from PowerShell:

```powershell
mysql -u root -p < database.sql
```

Or open MySQL Workbench, choose **Server > Data Import**, and import `database.sql`.

The script creates the `ebook_store` database and these tables:

- `users`
- `profiles`
- `otp_codes`
- `ebooks`
- `orders`

The session table is created automatically by `express-mysql-session` when the application first starts.

## 4. Create a Gmail App Password

1. Enable 2-Step Verification on the Google account that will send OTP emails.
2. Open the Google Account **App passwords** page.
3. Create an app password for the website.
4. Copy the generated 16-character password. Use this app password for `SMTP_PASSWORD`, not the normal Gmail password.

If App Passwords is unavailable, check whether 2-Step Verification is enabled or whether a managed Google Workspace administrator has disabled the feature.

## 5. Configure environment variables

Copy the example file:

```powershell
Copy-Item .env.example .env
```

Edit `.env`:

```dotenv
PORT=8000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=YOUR_MYSQL_PASSWORD
DB_NAME=ebook_store

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=youraddress@gmail.com
SMTP_PASSWORD=YOUR_16_CHARACTER_GOOGLE_APP_PASSWORD
SMTP_FROM_NAME=Inkframe Press

SESSION_SECRET=PASTE_A_LONG_RANDOM_SECRET_HERE
APP_ORIGIN=http://localhost:8000
ADMIN_EMAIL=owner@example.com
GOOGLE_CLIENT_ID=your-google-oauth-web-client-id.apps.googleusercontent.com
```

Generate a session secret in PowerShell:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Never commit `.env`. It is excluded by `.gitignore`.

## 6. Start the website and backend

### Enable Sign in with Google

1. In Google Cloud Console, configure the Google Auth Platform branding and audience for your project.
2. Create an OAuth client of type **Web application**.
3. Add `http://localhost` and `http://localhost:8000` to **Authorized JavaScript origins**. Add your exact public HTTPS origin for deployment, or another localhost port if you use it.
4. Put the client ID ending in `.apps.googleusercontent.com` into `GOOGLE_CLIENT_ID` in `.env`. This button uses Google's JavaScript popup flow; no client secret or redirect URI is required by this implementation.
5. If your Google app's testing configuration restricts users, add the accounts you want to test with. Restart the server and open `/signin/` at an authorized origin.

Google's button returns an ID token which the backend verifies against the configured client ID. A verified Google email signs into the same customer account used by email OTP, preserving saved profile details and purchase history. Missing or placeholder client IDs leave email OTP available. See [Google's setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

```powershell
npm run dev
```

Open:

```text
http://localhost:8000
```

Do not open the HTML files directly from the filesystem. Authentication, sessions, and protected routes require the Express server.

## 7. Authentication flow

1. Open `http://localhost:8000/signin/`.
2. Enter an email address and click **Send OTP**.
3. Enter the six-digit code received from Gmail.
4. After verification, the server creates a session and redirects to `/library/`.
5. Complete the full name and mobile fields and save the profile.
6. Click **Sign out** to destroy the session.

OTP rules:

- Codes expire after 10 minutes.
- Codes are stored only as bcrypt hashes.
- A new code invalidates earlier unused codes.
- Requests have a 60-second cooldown.
- An account can request at most five codes per hour.
- A code allows at most five incorrect verification attempts.

## 8. API reference

- `POST /api/auth/send-otp` with `{ "email": "customer@example.com" }`
- `POST /api/auth/verify-otp` with `{ "email": "customer@example.com", "otp": "123456" }`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/auth/google-config`
- `POST /api/auth/google` with a Google Identity Services ID-token credential
- `GET /api/profile` (authenticated)
- `POST /api/profile` (authenticated)
- `PUT /api/profile` (authenticated)
- `GET /api/library` (authenticated)
- `GET /api/store/products`
- `GET /api/store/cart` and `PUT /api/store/cart` (authenticated)
- `POST /api/store/coupon`
- `POST /api/store/orders` (authenticated; creates pending orders)
- `/api/admin/*` product, category, coupon, settings, order, customer, and dashboard APIs (administrator only)

The email configured as `ADMIN_EMAIL` becomes the owner after signing in with OTP or Google. There is no SMTP-account fallback. Without a configured owner, no account automatically receives owner access. Admin and customer changes are stored in MySQL. The legacy `/api/store/orders` endpoint creates pending orders.

## Admin login and management

Open `http://localhost:8000/admin/` in your browser. Sign in with the email in `ADMIN_EMAIL` in your live `.env`, using a six-digit email OTP or Google. There is no separate admin password. Restart the server after changing `.env`. The frontend provides the panel; Express checks the verified database account for every admin page and API request. A customer session, a forged session admin flag, or an unverified email does not grant access. Mutations require a session CSRF token, and requests from another browser origin are rejected.

The owner can grant access to other email addresses in **Admin access**, send an invitation, or revoke access immediately. Additional administrators can manage store data but cannot manage administrator access. Normal customers do not see an Admin navigation link.

- **Products:** add/edit, assign categories, upload covers, private PDFs and public sample PDFs, publish/draft/archive, search and bulk archive. Published products automatically appear in the storefront and have a `/product/?slug=...` detail page. Slugs remain stable after creation. Paid files accept PDFs up to 20 MB and are served only after a purchase check.
- **Categories:** add/edit names, descriptions, display order, status and banner images.
- **Orders:** search, status/date filters, correctly escaped CSV export, customer details, email status, download counts, email resend, and test refunds that revoke access. Email acceptance does not guarantee inbox placement.
- **Customers:** profile details, verification status, order histories, actual spending and last purchase dates.
- **Coupons:** create/edit/disable, percentage or INR discounts, expiry, minimum spend, usage limits and a selected product or all products.
- **Overview:** database totals, daily activity, real bestsellers; test orders are explicitly separated from real revenue.
- **Settings:** store metadata and GSTIN persist and reload. No live gateway, payout, real refund, or GST invoice generation is claimed. These need a separate payment integration.
- **Activity:** recent administrator changes, access grants/revocations and delivery actions.

Run `npm run test:admin` and `npm run test:checkout` for local integration tests. They create and clean up temporary records; outgoing email is mocked. `test:admin` also checks role forgery, CSRF rejection, private uploads, access revocation and multi-product checkout.

## Test purchase: Fitness for Busy Professionals

Restart `npm run dev` to apply the automatic order-column migration. Open the book page, choose **Buy Now** or **Add to Cart**, and continue to checkout. Sign in to verify the email that will receive the PDF, complete customer details, accept the terms, and click **Complete test payment**. No payment credentials or money are involved.

The server calculates the price and coupon, records a paid order with `payment_method=test`, saves customer details, removes the purchased book from the cart, and emails `server/private/ebooks/fitness-for-busy-professionals.pdf` as an attachment using the existing SMTP configuration. The receipt reads actual order and email status from the server. Failed email delivery can be retried after two minutes; the protected PDF is also available immediately on the receipt and in My Library. Checkout retries reuse a unique reference to prevent duplicate orders and coupon usage.

Test checkout supports published books with configured private PDFs, including multiple products in a cart, and is disabled when `NODE_ENV=production` or `TEST_PAYMENTS_ENABLED=false`. In development it is enabled by default. Test orders grant download access and are marked separately in the database; no real gateway is connected. SMTP acceptance is recorded, but inbox delivery still depends on the email provider.

The profile and library endpoints always obtain the user ID from the server session. They do not accept a browser-supplied user ID.

## 9. Manual security tests

Run these checks in the browser:

1. Request an OTP and confirm the email arrives.
2. Enter a wrong OTP and confirm it is rejected.
3. Wait more than 10 minutes and confirm the OTP expires.
4. Request another OTP within 60 seconds and confirm it is rate-limited.
5. Verify a valid OTP and save a profile.
6. Refresh `/library/` and confirm the session remains active.
7. Sign out and revisit `/library/`; confirm it redirects to `/signin/`.
8. Sign in again and confirm the saved profile is loaded.
9. Check MySQL:

```sql
use ebook_store;
select id, email, is_verified, created_at from users;
select user_id, full_name, mobile, updated_at from profiles;
select user_id, expires_at, consumed_at, attempts from otp_codes;
```

The `otp_codes` table must contain hashes, never readable six-digit OTP values.

## 10. Production settings

- Set `NODE_ENV=production` so the session cookie requires HTTPS.
- Set `APP_ORIGIN` to the public HTTPS website origin.
- Run Express behind an HTTPS reverse proxy.
- Keep MySQL and SMTP credentials only in the production environment.
- Back up MySQL and restrict the database user to the `ebook_store` database.
- Keep paid ebook files in `server/private/ebooks`. Downloads already check a paid order for the signed-in customer; real payments still require a verified gateway integration.
