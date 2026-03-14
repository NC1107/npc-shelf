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
npm run dev                 # both server + client concurrently
npm run dev:server          # tsx watch packages/server/src/index.ts
npm run dev:client          # cd packages/client && vite

# Run production server (serves client from packages/client/dist)
npx tsx packages/server/src/index.ts    # or: npm start (after build)

# Tests
npm test                    # vitest run (unit tests in packages/server/src/**/__tests__/)
npm run test:watch          # vitest watch mode
npx vitest run packages/server/src/services/__tests__/cover.test.ts  # single test file
npx playwright test         # e2e tests in e2e/

# Lint & format
npm run lint                # eslint packages/*/src --ext .ts,.tsx
npm run format              # prettier --write

# Database
npm run db:generate         # drizzle-kit generate (snapshot schema → migration SQL)
npm run db:migrate          # drizzle-kit migrate (apply pending migrations)
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
- **Job queue**: SQLite-backed, polled every 5s by `startJobProcessor()`. Job handlers registered in `index.ts` for: `scan_library`, `match_metadata`, `match_all_metadata`, `backfill_covers`, `merge_audiobook`, `convert_format`. Max 3 attempts with automatic retry.
- **Scanner** (`services/scanner.ts`): Walks library directories, hashes files (SHA-256, partial hash for large audio), extracts metadata from EPUB/MP3/M4B, creates book/file/author records, generates cover WebP resizes via sharp.
- **Metadata pipeline** (`services/metadata-pipeline.ts`): Queries Hardcover GraphQL API to enrich books with descriptions, covers, series info. Confidence scoring with bigram similarity + length penalty. Hard floor 0.3, title gate 0.5.
- **Hardcover provider** (`providers/hardcover.ts`): GraphQL client with token bucket rate limiter (60/min) and `requestWithRetry()` for 429/5xx backoff. ISBN data comes from Typesense search only (not `books_by_pk`).
- **Cover pipeline** (`services/cover.ts`): `extractAndCacheCover()` saves original + generates `{id}_thumb.webp`, `{id}_medium.webp`, `{id}_full.webp` via sharp. `cover-backfill.ts` regenerates missing WebP variants on startup.
- **File watcher** (`services/file-watcher.ts`): Chokidar-based watchers on library directories, initialized at startup via `initializeWatchers()`.
- **OPDS** (`routes/opds.ts`): OPDS catalog feed for external reader apps, mounted at `/opds`.
- **FTS5**: `books_fts` virtual table kept in sync via SQLite triggers on the books table.
- **Metadata writer** (`services/metadata-writer.ts`): Writes book metadata into file headers — EPUB (JSZip + fast-xml-parser for OPF), MP3 (node-id3), M4B (ffmpeg), PDF (pdf-lib), AZW3/MOBI (Calibre `ebook-meta`).
- **File renamer** (`services/file-renamer.ts`): Template-based renaming (`{author}/{series_prefix}{title}/{title}.{ext}`) with preview/execute pattern and path traversal protection.
- **Duplicate detector** (`services/duplicate-detector.ts`): Finds duplicates by file hash, title+author fuzzy match (0.85 threshold), and ISBN collision.
- **Format converter** (`services/format-converter.ts`): Calibre `ebook-convert` wrapper for EPUB ↔ MOBI/AZW3/PDF conversion. Queued as `convert_format` job.
- **Authors** (`routes/authors.ts`): Author listing with book counts, duplicate detection, and author merge.
- **External tools**: ffmpeg (audio merge, M4B metadata) and Calibre (ebook-meta, ebook-convert) are checked at startup; warnings logged if unavailable.

### Client (`@npc-shelf/client`)
React 19 + Vite 6 + TanStack Router + TanStack Query + Zustand + Tailwind v4 + shadcn/ui.

- **Routing**: TanStack Router with file-based routes in `src/routes/`. Root component gates on setup → login → authenticated shell. Route tree: `/dashboard`, `/library`, `/library/$bookId`, `/library/$bookId/read`, `/library/$bookId/listen`, `/search`, `/collections`, `/collections/$collectionId`, `/series`, `/series/$seriesId`, `/authors`, `/duplicates`, `/settings`.
- **API client** (`lib/api.ts`): Singleton `ApiClient` with auto-refresh on 401. All data fetching goes through `api.get/post/put/delete`.
- **Stores**: Zustand — `authStore` (token, user), `audioStore` (playback state, persisted), `readerStore` (reading positions), `uiStore` (theme, sidebar).
- **Dev proxy**: Vite proxies `/api` and `/opds` to `localhost:3001`.
- **EPUB reader**: react-reader with CFI position tracking. **PDF reader**: pdfjs-dist. **Audio player**: native HTMLAudioElement with chapter support.
- **shadcn/ui components** in `src/components/ui/` — use these patterns when adding new UI.

### Docker
Multi-stage build in `docker/Dockerfile` (shared → client → server → production). Production image is node:22-alpine with tini + ffmpeg. Volumes: `/data` (SQLite), `/cache` (covers), `/config`. Port 3000 in Docker (vs 3001 in dev).

## Key Patterns

- Vitest uses `globals: true` — no need to import `describe`, `it`, `expect` in test files
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
- ffmpeg and Calibre availability are checked at startup and before jobs that need them
- Filename parser (`utils/filename-parser.ts`) uses person-name heuristic + directory hint to disambiguate "Author - Title" vs "Title - Author" patterns

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3001 | Server port |
| DATABASE_PATH | ./data/npc-shelf.db | SQLite database file |
| COVER_CACHE_PATH | ./cache/covers | Cover image cache directory |
| JWT_SECRET | hardcoded dev secret | JWT signing secret |
| CORS_ORIGIN | http://localhost:5173 | Allowed CORS origin |
