# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# Full build (must be sequential: shared → client → server)
npm run build

# Individual builds
npm run build:shared
npm run build:client
npm run build:server

# Development (server on :3001, client on :5173 with proxy to server)
npm run dev:server          # npx tsx watch packages/server/src/index.ts
npm run dev:client          # cd packages/client && npx vite

# Run production server (serves client from packages/client/dist)
npx tsx packages/server/src/index.ts    # or: npm start (after build)

# Tests
npm test                    # vitest run (unit tests in packages/server/src/**/__tests__/)
npm run test:watch          # vitest watch mode
npx playwright test         # e2e tests in e2e/

# Database
npm run db:generate         # drizzle-kit generate (snapshot schema → migration SQL)
```

## Architecture

**Monorepo** with npm workspaces: `packages/shared`, `packages/server`, `packages/client`.

### Shared (`@npc-shelf/shared`)
TypeScript types and constants consumed by both server and client. All Book, Author, Library, Job, etc. interfaces live here, along with format lists, auth config, and size constants. Changes require rebuilding shared first.

### Server (`@npc-shelf/server`)
Express.js on Node 22 with SQLite (better-sqlite3) and Drizzle ORM.

- **Database**: Schema defined in `src/db/schema/` (11 files). Tables are created via raw SQL in `src/db/index.ts:initializeDatabase()` using `CREATE TABLE IF NOT EXISTS`. Drizzle ORM is used for all query operations in routes. Drizzle migrations are set up but the initial migration hasn't been generated yet — the raw SQL handles the baseline.
- **Auth**: Single-user MVP. Password-only login (`POST /api/auth/login`). JWT access token (15min) + refresh token (7d, HttpOnly cookie). `authMiddleware` checks Bearer token.
- **Cover images are served publicly** — the `GET /api/books/:id/cover/:size` route is registered BEFORE authMiddleware in `index.ts` because `<img>` tags cannot send Bearer tokens. All other `/api/books/*` routes are protected.
- **Job queue**: SQLite-backed, polled every 5s by `startJobProcessor()`. Job handlers registered in `index.ts` for: `scan_library`, `match_metadata`, `match_all_metadata`, `backfill_covers`, `merge_audiobook`. Max 3 attempts with automatic retry.
- **Scanner** (`services/scanner.ts`): Walks library directories, hashes files (SHA-256, partial hash for large audio), extracts metadata from EPUB/MP3/M4B, creates book/file/author records, generates cover WebP resizes via sharp.
- **Metadata pipeline** (`services/metadata-pipeline.ts`): Queries Hardcover GraphQL API to enrich books with descriptions, covers, series info. Confidence scoring with bigram similarity + length penalty. Minimum threshold 0.5, title gate 0.4.
- **Hardcover provider** (`providers/hardcover.ts`): GraphQL client with token bucket rate limiter (60/min) and `requestWithRetry()` for 429/5xx backoff. ISBN data comes from Typesense search only (not `books_by_pk`).
- **Cover pipeline** (`services/cover.ts`): `extractAndCacheCover()` saves original + generates `{id}_thumb.webp`, `{id}_medium.webp`, `{id}_full.webp` via sharp. `cover-backfill.ts` regenerates missing WebP variants on startup.
- **FTS5**: `books_fts` virtual table kept in sync via SQLite triggers on the books table.

### Client (`@npc-shelf/client`)
React 19 + Vite 6 + TanStack Router + TanStack Query + Zustand + Tailwind v4 + shadcn/ui.

- **Routing**: TanStack Router with routes defined in `src/routes/__root.tsx`. Root component gates on setup → login → authenticated shell. Route tree: `/dashboard`, `/library`, `/library/$bookId`, `/library/$bookId/read`, `/library/$bookId/listen`, `/search`, `/collections`, `/series`, `/settings`.
- **API client** (`lib/api.ts`): Singleton `ApiClient` with auto-refresh on 401. All data fetching goes through `api.get/post/put/delete`.
- **Stores**: Zustand — `authStore` (token, user), `audioStore` (playback state, persisted), `readerStore` (reading positions), `uiStore` (theme, sidebar).
- **Dev proxy**: Vite proxies `/api` and `/opds` to `localhost:3001`.
- **EPUB reader**: react-reader with CFI position tracking. **PDF reader**: pdfjs-dist. **Audio player**: native HTMLAudioElement with chapter support.
- **shadcn/ui components** in `src/components/ui/` — use these patterns when adding new UI.

### Docker
Multi-stage build in `docker/Dockerfile` (shared → client → server → production). Production image is node:22-alpine with tini + ffmpeg. Volumes: `/data` (SQLite), `/cache` (covers), `/config`. Port 3000 in Docker (vs 3001 in dev).

## Key Patterns

- Server uses `.js` extensions in all imports (ESM requirement): `import { foo } from './bar.js'`
- Drizzle schema files define column mappings; raw SQL in `initializeDatabase()` creates actual tables
- `parseInt(req.params.id)` must be checked for `isNaN` and return 400
- All error responses should use `{ error: string }` format
- Cover URLs in the client: `/api/books/${id}/cover/thumb` (grid) or `/cover/medium` (detail)
- Client conditionally renders `<img>` only when `book.coverPath` is truthy, with fallback icons
- The `@npc-shelf/shared` constants (`COVER_SIZES`, `AUTH`, `JOB_QUEUE`, `METADATA`) are the source of truth for magic numbers
- Settings values are stored as strings in the DB — client must compare with `'false'`/`'true'`, not booleans
- Books list endpoint filters out ghost books (no files) by default
- Cover processing validates image format via `sharp().metadata()` before saving
- ffmpeg availability is checked at startup and before audio merge jobs

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3001 | Server port |
| DATABASE_PATH | ./data/npc-shelf.db | SQLite database file |
| COVER_CACHE_PATH | ./cache/covers | Cover image cache directory |
| JWT_SECRET | hardcoded dev secret | JWT signing secret |
| CORS_ORIGIN | http://localhost:5173 | Allowed CORS origin |
