# Inkframe Press e-book website

The website files live in `client/`. The Node.js backend lives in `server/`.
Run commands from this project folder, where `package.json` and `.env` are located.

## Start the website

```powershell
npm start
```

Open `http://localhost:8000` (or the port configured in `.env`). MySQL must be running.
For automatic server restarts during development, use `npm run dev`.
Use the Express server to view the website: opening HTML files directly or using
VS Code Live Server does not provide the login, catalogue, or protected downloads.

See [backend setup instructions](server/README-BACKEND.md) for first-time setup.
The database setup file is [server/database.sql](server/database.sql).
Keep an existing `.env`; only copy `.env.example` when setting up a new installation.

## Folder guide

```text
client/
  pages/          About, admin, cart, categories, checkout, confirm-signup,
                  contact, privacy, product, signin, terms, thank-you
  assets/
    css/          Stylesheets
    js/           Browser JavaScript
    fonts/        Font files
    images/       Website images
    uploads/      Existing and new public cover images and sample PDFs
    scripts/      Node.js maintenance and integration-test scripts
  library/        Customer library page
  ebooks/         E-book listing and existing book pages
  index.html      Homepage
server/
  private/ebooks/ Paid PDFs; access requires a purchase
  database.sql    Database setup
  README-BACKEND.md
  ...             Existing backend modules and routes
```

`.vscode`, `node_modules`, `.env`, `.env.example`, `.gitignore`, `package.json`,
and `package-lock.json` remain at the project root. `.tmp` is preserved for
existing preview files and verification reports. New temporary files and both
backup folders are ignored by Git; previously tracked `.tmp` files remain tracked.
The existing project folder name is retained.

## Website addresses

Page addresses remain `/about/`, `/signin/`, `/ebooks/`, and so on. The server maps
these addresses to the new folders; visitors do not need `/client/` or `/pages/`
in their links. Styles, browser scripts, fonts, and images now use `/assets/...`.
Older `/css/`, `/js/`, `/fonts/`, and `/images/` links continue working, including
image paths already saved in the database. Public uploads keep `/assets/uploads/`.
Maintenance scripts are not served to visitors. Paid PDFs stay in `server/private/ebooks/`.

## Checks

- `npm run check`: JavaScript syntax checks.
- `npm run test:admin` and `npm run test:checkout`: existing database integration
  tests; these create and clean up temporary records and mock outgoing email.
- `npm run check:email`: checks the configured email transport.

The restructure was checked against a local server on port 8016: 16 page routes,
71 distinct local URLs, 26 JavaScript files, and 42 relative module imports passed.
Older asset URLs were compared with their new equivalents. Login redirects and
private-file restrictions also passed. Upload destinations were checked using
mocked writes, without creating files or changing customer records.
No missing local images, styles, fonts, or scripts were found. This was an HTTP
and static-code check, not a visual browser or complete purchase-flow test.
Third-party Tailwind and Google scripts were left unchanged and were not verified.
The detailed check output is in `.tmp/restructure-verification.json`.

## Backups and restoration

`backup-before-restructure/` contains the original project, including `.env`,
dependencies, uploads, private PDFs, and temporary files. All 1,826 files were
verified against their originals before any changes. It has not been edited.
`backup-git-before-restructure/` separately preserves the parent repository's Git
metadata from before the moves. Git tracks this project from the parent folder.
All requested moves used `git mv`; the previously untracked uploaded image was
added to Git first so it could be moved with the others. No commit was created.

To recover the old layout safely, copy `backup-before-restructure/` to a new,
empty folder, then run it there. Keep the current project and backups until the
restored copy is checked. The folder backup does not snapshot the live MySQL
database; do not replace the parent Git metadata casually because it may cover
other files outside this project.
