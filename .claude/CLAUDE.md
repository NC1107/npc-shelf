# NPC-Shelf — Claude Code Guide

## What This Project Is

NPC-Shelf is a **self-hosted personal book library manager**. Think Calibre meets Plex — a single Docker container that scans your ebook/audiobook directories, enriches metadata from Hardcover, and serves a modern web UI for browsing, reading, and listening.

**Target user**: A single person running this on a home server or NAS. Not multi-tenant. Not cloud-hosted. Privacy and local-first matter.

**Core value prop**: Drop your files in a directory, NPC-Shelf handles the rest — scanning, metadata, covers, reading/listening in-browser, OPDS for external apps.

## Environment

- **OS**: Windows 11 (development), Linux Alpine (Docker production)
- **Runtime**: Node.js 22 (LTS)
- **Shell**: bash on Windows (Git Bash / WSL-style) — use Unix paths and syntax, not Windows
- **Monorepo**: npm workspaces — `packages/shared`, `packages/server`, `packages/client`
- **Database**: SQLite via better-sqlite3 + Drizzle ORM — no Postgres, no external DB
- **External tools**: ffmpeg (audio), Calibre (ebook conversion) — optional, checked at startup

## Working With Nick (the maintainer)

### Commit Rules
- **No co-author lines.** Do not append `Co-Authored-By` to commits. Ever.
- **Every commit gets a version bump.** When you commit, bump the patch version in all 4 `package.json` files (root, shared, client, server) and tag it `vX.Y.Z`. This is the release process — there is no separate release step.
- **Commit message style**: Lowercase prefix (`fix:`, `feat:`, `chore:`, `docs:`), concise subject line, bullet-point body if needed. No emoji.
- **Tag format**: `vX.Y.Z` (e.g., `v0.5.1`)

### Version Bumping
- **Patch** (`0.5.x`): Bug fixes, code cleanup, dependency updates, SonarLint fixes
- **Minor** (`0.x.0`): New features, new UI pages, new API endpoints
- **Major** (`x.0.0`): Breaking changes (hasn't happened yet, don't expect it soon)

### Communication Style
- Be terse. No trailing summaries. No "here's what I did" recaps — the diff speaks.
- Don't ask permission for mechanical changes. Just do them.
- Do ask before: architectural decisions, new dependencies, deleting features, anything irreversible on shared state (push, force operations).

### What to Avoid
- Don't add comments, docstrings, or type annotations to code you didn't change
- Don't refactor adjacent code "while you're in there"
- Don't over-engineer. This is a solo project, not enterprise software
- Don't mock the database in tests — use real SQLite
- Don't create README/doc files unless explicitly asked

## Tech Stack Quick Reference

### Server
- Express.js + TypeScript (ESM — **all imports use `.js` extensions**)
- SQLite via better-sqlite3 — tables created by raw SQL in `db/index.ts`, queries via Drizzle ORM
- JWT auth (access 15min + refresh 7d HttpOnly cookie)
- Job queue: SQLite-backed, polled every 5s, max 3 retries
- Metadata: Hardcover GraphQL API with rate limiting (60/min) and retry
- Covers: sharp for WebP resize (thumb/medium/full)

### Client
- React 19 + Vite 6 + TypeScript
- TanStack Router (file-based routes in `src/routes/`)
- TanStack Query for data fetching
- Zustand stores (auth, audio, reader, ui)
- Tailwind v4 + shadcn/ui components
- EPUB: react-reader | PDF: pdfjs-dist | Audio: native HTMLAudioElement

### Build
```bash
npm run build          # sequential: shared -> client -> server
npm test               # vitest (server unit tests)
npm run lint           # eslint
npm run dev            # concurrent dev server (3001) + client (5173)
```

## Key Gotchas

- Settings stored as strings in DB — compare with `'true'`/`'false'`, not booleans
- Cover routes are public (registered before auth middleware) — `<img>` tags can't send Bearer tokens
- Books list filters out "ghost books" (no files) by default
- FTS5 virtual table `books_fts` synced via SQLite triggers
- Hardcover ISBNs come from Typesense search `isbns` array only, not `books_by_pk`
- Scanner uses partial SHA-256 hashing for large audio files
- `@npc-shelf/shared` constants are the source of truth for magic numbers

## Testing

- Framework: Vitest with `globals: true` (no need to import describe/it/expect)
- Tests live in `packages/server/src/**/__tests__/`
- Always run `npm run build && npm test` before committing
- E2E: Playwright (in `e2e/`)
