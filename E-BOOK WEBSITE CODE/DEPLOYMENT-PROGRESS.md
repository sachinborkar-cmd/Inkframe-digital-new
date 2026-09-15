# Inkframe Press deployment progress

Reference: `Inkframe_Press_Deployment_Plan.pdf` (reviewed 15 September 2026).

Status labels: **Done** means implemented and evidenced in this repository; **Pending** means it requires production infrastructure, a provider choice, or live verification.

| Phase | Status | Current position |
| --- | --- | --- |
| 1. Local project audit | In progress | Express/MySQL structure, `.env.example`, `.gitignore`, backend documentation and local checks exist. Run the complete test suite successfully before release. |
| 2. GitHub repository | Partial | Git is clean and secrets are ignored. The repository still tracks public uploads and private e-book PDFs, which should move to managed object storage before a public production repository. |
| 3. Production database | Pending | Production MySQL, least-privilege user, schema/catalog migration, backups and restore test are required. |
| 4. Backend/API deployment | Pending | Backend is implemented with security controls; select and deploy to a production host, configure production variables and verify it live. |
| 5. Frontend deployment | Pending | Storefront is implemented; deploy it (currently served by Express) and test its public URLs and responsive layouts. |
| 6. Domain, DNS and HTTPS | Pending | Connect `inkframepress.com`, select canonical hostname, configure API origin/subdomain as needed, and verify HTTPS. |
| 7. File and image storage | Partial | Paid downloads are server-authorized and private on disk. Move covers and paid PDFs out of Git/repository storage to suitable object storage with protected delivery. |
| 8. Payments and webhooks | Pending — launch blocker | No live gateway is selected or integrated. Test checkout is development-only. |
| 9. Email | Partial | Nodemailer/SMTP flows and email checks exist. Configure a production sender/domain and verify inbox delivery across providers. |
| 10. Analytics and SEO | Partial | Admin analytics exists. Add production traffic/funnel analytics, attribution, sitemap, robots, canonical/meta/Open Graph data. |
| 11. Security | Done locally | Role-based admin access, CSRF/origin protection, rate limits, validation, secure headers, password recovery and protected downloads are implemented. Production secrets, HTTPS and hosting review still required. |
| 12. Staging and full QA | Pending | Create staging and complete browser, mobile, performance, payment and authorization tests. |
| 13. Backups and monitoring | Pending | Configure database/storage backups, restore drill, uptime/error/resource monitoring and alerts. |
| 14. Production launch | Pending | Complete the final checklist, perform one controlled real order, then monitor the first 24 hours. |

## Completed work evidenced in the repository

- Customer storefront, catalogue, product pages, cart, checkout UI, account/library and admin interface.
- MySQL-backed authentication (email OTP, Google and password recovery), sessions and customer profiles.
- Role-based admin authorization, CSRF/origin protection, rate limiting, validation, security headers and protected paid-file access.
- Product/category/coupon/order/customer/admin management and server-side business analytics.
- Test-payment flow for development only; it is disabled in production.
- `.env` is ignored, `.env.example` contains placeholders, and the working tree was clean when reviewed.
- `npm run check` passed on 15 September 2026.

## Immediate next tasks, in order

1. Resolve the local Vitest/Vite `spawn EPERM` issue and run the entire automated suite successfully; then run database-backed and browser/manual tests.
2. Choose the production architecture: host, managed MySQL, object storage, monitoring and email provider.
3. Choose and implement a payment gateway with server-side order creation, signature verification, authenticated webhooks, idempotency, refunds and payment test cases.
4. Move production PDFs and images from Git/repository storage; migrate only approved catalogue data to a new production database.
5. Deploy staging with production-like environment variables, HTTPS and a non-production payment mode; complete end-to-end and mobile QA.
6. Configure domain/DNS, canonical redirects, production SMTP sender, SEO metadata/sitemap and analytics.
7. Enable backups and monitoring, verify a restore, conduct a controlled production order, then launch.

## Current release blockers

- A live payment provider and authenticated webhook flow do not exist.
- No production/staging hosting, database, domain/DNS, HTTPS, storage, backup or monitoring setup is evidenced locally.
- Full automated tests have not completed in this environment: Vitest/Vite failed to spawn a helper process with Windows `EPERM`.
