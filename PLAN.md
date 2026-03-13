# NPC-Shelf — Self-Hosted Book Library Platform

## Context

We are building a self-hosted book platform for managing ebooks and audiobooks with browser-based reading, audio streaming, metadata enrichment, and device delivery. The project directory is empty — this is a greenfield build. The system must be simple to deploy via Docker, low on resources, and modular enough to add multi-user support later without major refactoring.

---

## Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Runtime** | Node.js 20 (TypeScript) | Excellent I/O, unified language, mature ecosystem |
| **Backend framework** | Express.js | Simple, well-understood, huge middleware ecosystem |
| **Database** | SQLite via `better-sqlite3` + Drizzle ORM | Zero-config, single file, all similar platforms use SQLite successfully |
| **Frontend framework** | React 19 + TypeScript | `react-reader` for EPUB, `shadcn/ui` components, largest ecosystem |
| **Build tool** | Vite 6 | Fast HMR, native ESM |
| **Routing** | TanStack Router | Type-safe routes, built-in code splitting |
| **Server state** | TanStack Query v5 | Caching, pagination, background refetch |
| **Client state** | Zustand v5 | Lightweight, slices pattern, persist middleware |
| **UI components** | shadcn/ui + Tailwind CSS v4 | Accessible (Radix primitives), theme-able, owned code |
| **EPUB reader** | react-reader (epub.js wrapper) | Mature, CFI position tracking, sandboxed iframe |
| **PDF viewer** | pdfjs-dist | Industry standard, text selection, annotations |
| **Audio metadata** | `music-metadata` (MP3/ID3) + `ffprobe` (M4B chapters) | Pure JS where possible, ffprobe for M4B container |
| **Metadata API** | Hardcover GraphQL via `graphql-request` | Lightweight GraphQL client, 4KB |
| **Image processing** | `sharp` | Cover resize/optimize |
| **Email** | `nodemailer` | Send-to-Kindle SMTP delivery |
| **OPDS XML** | `xmlbuilder2` | OPDS 1.2 feed generation |
| **Monorepo** | npm workspaces | No extra tooling needed |
| **Container** | node:20-alpine + tini | Small image (~180MB), proper signal handling |

---

## Project Structure

```
npc-shelf/
  package.json                      # npm workspaces root
  tsconfig.base.json
  vitest.workspace.ts
  packages/
    shared/                         # Shared TypeScript types
      src/types.ts
      src/constants.ts
    server/                         # Backend
      src/
        index.ts                    # Entry point, Express app bootstrap
        db/
          index.ts                  # SQLite connection, Drizzle init, WAL mode
          schema/                   # Drizzle table definitions
            books.ts
            files.ts
            libraries.ts
            authors.ts
            series.ts
            collections.ts
            tags.ts
            users.ts
            progress.ts
            settings.ts
            jobs.ts
          migrations/               # Numbered migration files
        routes/
          auth.ts
          books.ts
          libraries.ts
          audio.ts
          reader.ts
          metadata.ts
          opds.ts
          kindle.ts
          collections.ts
          settings.ts
          search.ts
        services/
          scanner.ts                # Directory traversal, file detection, hashing
          epub-parser.ts            # EPUB metadata extraction
          audio-parser.ts           # M4B chapter extraction, MP3 ID3 tags
          metadata-pipeline.ts      # Matching orchestration + confidence scoring
          cover.ts                  # Download, resize, cache covers
          kindle.ts                 # SMTP email delivery
          opds.ts                   # OPDS feed generation
          export.ts                 # OPF/JSON sidecar export
          job-queue.ts              # SQLite-backed background job processor
        providers/
          metadata-provider.ts      # Pluggable interface definition
          hardcover.ts              # Hardcover GraphQL implementation
        middleware/
          auth.ts                   # JWT access/refresh token handling
          path-validator.ts         # Path traversal protection
          rate-limit.ts             # Rate limiting (strict on auth, lenient on API)
          opds-auth.ts              # HTTP Basic auth for OPDS clients
        utils/
          filename-parser.ts        # Extract title/author from filenames
          string-similarity.ts      # Fuzzy matching for metadata
    client/                         # Frontend
      src/
        main.tsx
        App.tsx
        routes/                     # TanStack Router route definitions
          __root.tsx                # AppShell layout + persistent AudioMiniPlayer
          dashboard.tsx
          library.tsx
          library.$bookId.tsx
          library.$bookId.read.tsx
          library.$bookId.listen.tsx
          collections.tsx
          series.tsx
          search.tsx
          settings.tsx
          login.tsx
        components/
          ui/                       # shadcn/ui components (owned, not dependency)
          layout/                   # AppShell, Sidebar, TopBar
          books/                    # BookCard, BookGrid, BookDetail, FilterSidebar
          reader/                   # EpubReader, PdfReader, ReaderToolbar, ReaderSettings
          audio/                    # AudioMiniPlayer, AudioFullPlayer, ChapterList
          metadata/                 # MetadataEditor, MetadataSearch
          kindle/                   # SendToKindle dialog
          search/                   # SearchBar (cmdk), SearchResults
        stores/
          audioStore.ts             # Persistent audio playback state (Zustand)
          readerStore.ts            # Reader preferences (font, theme, margins)
          uiStore.ts                # Sidebar, library view, app theme
          authStore.ts              # JWT tokens, user info
        lib/
          api.ts                    # TanStack Query client + fetch wrapper
          AudioEngine.ts            # Singleton HTMLAudioElement manager
        styles/
          globals.css               # Tailwind base + CSS variable themes
      tests/
  docker/
    Dockerfile                      # Multi-stage: build frontend -> build backend -> production
    docker-compose.yml
    docker-compose.dev.yml
  .github/workflows/
    ci.yml
```

---

## Database Schema

All tables include `user_id` foreign key for multi-user readiness (default user ID = 1 for MVP).

### Core Tables

**users** — `id`, `username`, `password_hash`, `role` (admin/user), `created_at`, `updated_at`

**libraries** — `id`, `name`, `path`, `type` (ebook/audiobook/mixed), `scan_enabled`, `last_scanned_at`, `created_at`

**books** — `id`, `title`, `subtitle`, `description`, `language`, `publisher`, `publish_date`, `page_count`, `isbn_10`, `isbn_13`, `hardcover_id`, `match_confidence`, `cover_path`, `blurhash`, `audio_seconds`, `created_at`, `updated_at`

**files** — `id`, `book_id` (FK), `library_id` (FK), `path`, `filename`, `format` (epub/pdf/mobi/azw3/m4b/mp3), `mime_type`, `size_bytes`, `hash_sha256`, `last_modified`, `created_at`

**authors** — `id`, `name`, `sort_name`, `hardcover_id`, `bio`, `photo_url`

**book_authors** — `book_id`, `author_id`, `role` (author/narrator/editor)

**series** — `id`, `name`, `hardcover_id`

**book_series** — `book_id`, `series_id`, `position`

**tags** — `id`, `name`, `source` (hardcover/user)

**book_tags** — `book_id`, `tag_id`

**collections** — `id`, `user_id`, `name`, `description`, `created_at`

**book_collections** — `book_id`, `collection_id`, `sort_order`

### Progress Tables

**reading_progress** — `id`, `user_id`, `book_id`, `format` (epub/pdf), `cfi` (EPUB CFI string), `page_number` (PDF), `total_pages`, `progress_percent` (0.0-1.0), `updated_at` — UNIQUE(user_id, book_id)

**audio_progress** — `id`, `user_id`, `book_id`, `current_track_index`, `position_seconds`, `total_elapsed_seconds`, `total_duration_seconds`, `playback_rate`, `is_finished`, `updated_at` — UNIQUE(user_id, book_id)

### Audio Tables

**audio_tracks** — `id`, `book_id`, `file_id`, `track_index`, `title`, `duration_seconds`, `start_offset_seconds` (cumulative offset for position calc)

**audio_chapters** — `id`, `book_id`, `title`, `start_time`, `end_time`, `track_index` (which track this chapter falls in)

### System Tables

**metadata_cache** — `id`, `book_id`, `provider`, `external_id`, `raw_data` (JSON), `fetched_at`

**job_queue** — `id`, `job_type`, `payload` (JSON), `status` (pending/processing/completed/failed), `attempts`, `max_attempts`, `error`, `scheduled_for`, `created_at`, `updated_at`

**kindle_settings** — `id`, `user_id`, `kindle_email`, `created_at`

**kindle_deliveries** — `id`, `user_id`, `book_id`, `kindle_email`, `status`, `message_id`, `error`, `file_format`, `file_size_bytes`, `created_at`

**settings** — `key`, `value` (JSON), `updated_at`

**FTS5 virtual table** on books (title, subtitle, description) for full-text search.

---

## API Design

### Authentication
```
POST   /api/setup                    # First-run password creation
POST   /api/auth/login               # Password -> access token + refresh cookie
POST   /api/auth/refresh             # Refresh cookie -> new access token
POST   /api/auth/logout              # Invalidate refresh token
```

### Libraries
```
GET    /api/libraries                 # List all libraries
POST   /api/libraries                 # Add library root
PUT    /api/libraries/:id             # Update library settings
DELETE /api/libraries/:id             # Remove library
POST   /api/libraries/:id/scan       # Trigger scan
GET    /api/libraries/:id/scan/status # Scan progress (SSE or poll)
```

### Books
```
GET    /api/books                     # List/filter/sort (paginated, FTS5 search via ?q=)
GET    /api/books/:id                 # Book detail with authors, series, files, progress
GET    /api/books/:id/cover/:size     # Cover image (thumb/medium/full)
GET    /api/books/:id/file            # Download book file
DELETE /api/books/:id                 # Remove from library index (not disk)
```

### Reader
```
GET    /api/books/:id/content         # Serve EPUB/PDF for browser reader (sanitized)
GET    /api/books/:id/progress        # Get reading position
PUT    /api/books/:id/progress        # Update reading position
```

### Audio
```
GET    /api/audiobooks/:id/stream/:trackIndex  # Audio stream (HTTP Range support)
GET    /api/audiobooks/:id/chapters   # Chapter list
GET    /api/audiobooks/:id/progress   # Playback position
PUT    /api/audiobooks/:id/progress   # Update playback position
```

### Metadata
```
POST   /api/metadata/match/:bookId    # Trigger Hardcover match for a book
POST   /api/metadata/match-all        # Batch match all unmatched books
GET    /api/metadata/search?q=        # Search Hardcover directly (for manual matching)
PUT    /api/books/:id/metadata        # Manual metadata edit
POST   /api/books/:id/export          # Export OPF/JSON sidecar
```

### Collections & Tags
```
GET    /api/collections               # List collections
POST   /api/collections               # Create collection
PUT    /api/collections/:id           # Update collection
DELETE /api/collections/:id           # Delete collection
POST   /api/collections/:id/books     # Add books to collection
DELETE /api/collections/:id/books/:bookId
GET    /api/tags                      # List all tags
```

### Kindle
```
POST   /api/kindle/send/:bookId       # Send book to Kindle
GET    /api/kindle/settings           # Get Kindle config
PUT    /api/kindle/settings           # Update Kindle email + SMTP config
GET    /api/kindle/history            # Delivery history
```

### OPDS (HTTP Basic Auth, separate from JWT)
```
GET    /opds                          # Root navigation feed
GET    /opds/recent                   # Recently added (acquisition feed, paginated)
GET    /opds/authors                  # Author list (navigation feed)
GET    /opds/authors/:id              # Books by author (acquisition feed)
GET    /opds/series                   # Series list
GET    /opds/series/:id               # Books in series
GET    /opds/collections/:id          # Books in collection
GET    /opds/search?q=               # Search results (acquisition feed)
```

### Settings & Health
```
GET    /api/settings                  # App settings
PUT    /api/settings                  # Update settings
GET    /api/health                    # Health check (for Docker HEALTHCHECK)
```

---

## Key Architecture Decisions

### File Indexing Pipeline
1. Traverse library directories recursively
2. Filter by supported extensions (epub, pdf, mobi, azw3, m4b, mp3)
3. Compute SHA-256 hash (full file for ebooks, first+last 64KB for large audiobooks)
4. Check hash against existing files for duplicate detection
5. Extract embedded metadata (EPUB OPF, ID3 tags, ffprobe for M4B)
6. Parse filename as fallback (regex patterns: "Author - Title", "Title (Year)", etc.)
7. Create book + file records in DB
8. Incremental scan: compare file modification times + hashes, detect new/changed/removed

### Metadata Enrichment Pipeline
1. Extract local metadata from files
2. Search Hardcover by ISBN (confidence 0.95-1.0)
3. Fallback: search by title + author with fuzzy matching (confidence 0.6-0.9)
4. Fallback: search by title only (confidence 0.3-0.6)
5. Download cover image -> resize to thumb (200x300) + medium (400x600) via `sharp`
6. Store enriched metadata in DB, raw response in metadata_cache
7. Rate-limited to 60 req/min via token bucket
8. Background processing via SQLite-backed job queue (poll every 5 seconds)

### Ebook Reader Security
1. Serve EPUB content through server-side HTML sanitization (strip `<script>`, event handlers)
2. CSP header on reader content: `script-src 'none'`
3. epub.js iframe with `sandbox="allow-same-origin"` (no `allow-scripts`)
4. Never expose raw filesystem paths to client — all files referenced by database ID

### Audio Streaming
- M4B/MP3 served directly (no transcoding — browsers support natively)
- HTTP Range requests for seeking in large files (Express `res.sendFile` handles this)
- M4B chapters extracted via `ffprobe -show_chapters`
- MP3 multi-file: each file = one track, natural sort order, ID3 for metadata
- Client uses singleton `AudioEngine` class managing one `HTMLAudioElement` outside React

### Authentication
- MVP: single user, password-only login (no username field needed)
- JWT access token (15min, in memory only) + refresh token (7 days, HttpOnly cookie)
- Refresh token rotation with reuse detection
- Multi-user ready: `users` table exists from day one, add registration endpoint later
- OPDS uses separate HTTP Basic Auth (standard for e-reader clients)

### Docker Deployment
- Single container: Node.js serves both API and static frontend assets
- Multi-stage Dockerfile: build frontend -> build backend -> alpine production image
- Non-root user (`npcshelf:1001`), tini as PID 1, health check included
- Volumes: `/data` (SQLite DB), `/config` (YAML config), `/cache` (covers), `/libraries/*` (read-only mounts)
- Library directories mounted as `:ro` — NPC-Shelf never writes to media directories

---

## Frontend Architecture

### Views
- **Dashboard** — Recent additions, in-progress books, library stats
- **Library browser** — Responsive grid (TanStack Virtual for 10k+ books), filter sidebar, sort, search
- **Book detail** — Cover, metadata, files, progress, actions (read/listen/send-to-kindle/edit metadata)
- **Ebook reader** — Full-screen, epub.js rendering, toolbar (font/theme/margins), progress bar
- **Audiobook player** — Persistent mini-player (bottom bar) + full player view with chapter list
- **Collections/Series** — Grouped views with cover mosaics
- **Search** — Global search via cmdk Command component (Cmd+K)
- **Settings** — Libraries, metadata providers, Kindle SMTP, appearance

### Key Patterns
- **AudioMiniPlayer** lives in root layout, outside route outlet, persists across all navigation
- **Audio state** in Zustand store with `AudioEngine` singleton managing `HTMLAudioElement`
- **Reading preferences** persisted to localStorage via Zustand persist middleware
- **Theme** — Light/Dark/System via CSS variables (shadcn/ui pattern), `.dark` class on `<html>`
- **Mobile-first** — Sidebar becomes drawer on mobile, grid columns adapt, reader goes full-screen

### Impeccable Design Workflow
Run structured quality passes after each major view is complete:
1. `/critique` + `/audit` — identify issues
2. `/normalize` + `/clarify` + `/adapt` — consistency, readability, responsiveness
3. `/polish` + `/harden` + `/optimize` — visual finish, error states, performance
4. `/animate` + `/delight` + `/colorize` — motion, micro-interactions, color

Priority for full passes: **Ebook Reader** and **Audio Player** (where users spend 90% of time).

---

## Implementation Phases

### Phase 1 — Core Infrastructure ✅
- [x] Initialize monorepo with npm workspaces (packages/server, packages/client, packages/shared)
- [x] Set up TypeScript, ESLint, Prettier configs
- [x] Set up Express server with health endpoint
- [x] Initialize SQLite + Drizzle ORM with migration system
- [x] Create database schema (all tables)
- [x] Set up Vite + React + TanStack Router + Tailwind + shadcn/ui
- [x] Build AppShell layout (sidebar, topbar, route outlet)
- [x] Implement authentication (setup, login, JWT, refresh tokens, middleware)
- [x] Build login page
- [x] Create Dockerfile + docker-compose.yml
- **Deliverable**: Running Docker container with auth-protected empty shell

### Phase 2 — Library Indexing
- [ ] Library CRUD API + settings UI
- [ ] Directory scanner service (recursive traversal, extension filtering)
- [ ] File hashing (SHA-256, partial hash for large audio files)
- [ ] EPUB metadata extraction (OPF parsing)
- [ ] Audio metadata extraction (ID3 via music-metadata, M4B via ffprobe)
- [ ] Filename parsing fallback
- [ ] Duplicate detection
- [ ] Incremental scan (detect new/changed/removed)
- [ ] Background scan job with progress reporting
- [ ] Database indexing (FTS5 for search)
- **Deliverable**: System scans directories, indexes files, shows them in UI

### Phase 3 — Library UI
- [ ] BookCard component with cover, progress bar, format badges
- [ ] Library grid with TanStack Virtual (virtual scrolling)
- [ ] Filter sidebar (format, author, series, tag, read status)
- [ ] Sort options (title, author, date added, last read)
- [ ] Book detail page (metadata display, file info)
- [ ] Search with FTS5 backend + cmdk frontend
- [ ] Dashboard with recent additions and in-progress books
- **Deliverable**: Browseable, searchable, filterable library UI
- **Impeccable passes**: /critique, /audit, /normalize, /adapt, /polish

### Phase 4 — Metadata Integration
- [ ] Hardcover GraphQL client with rate limiting (token bucket, 60 req/min)
- [ ] Book matching algorithm (ISBN -> title+author -> title-only, confidence scoring)
- [ ] Cover image pipeline (download, resize via sharp, cache)
- [ ] Metadata enrichment background jobs
- [ ] Manual metadata editor with Hardcover search
- [ ] Metadata refresh/re-match capability
- **Deliverable**: Books automatically enriched with covers, descriptions, series info

### Phase 5 — Ebook Reader
- [ ] EPUB reader via react-reader (epub.js)
- [ ] PDF reader via pdfjs-dist
- [ ] Reader chrome (toolbar, TOC, settings panel)
- [ ] Reader settings (font size, family, theme, margins, line height)
- [ ] Themes: light, dark, sepia
- [ ] Progress tracking (CFI for EPUB, page number for PDF)
- [ ] Resume position on book open
- [ ] Security: server-side HTML sanitization, CSP headers, sandbox
- [ ] Mobile: touch gestures, responsive layout, full-screen
- **Deliverable**: Read EPUBs and PDFs in the browser with position tracking
- **Impeccable passes**: Full cycle — /critique through /delight

### Phase 6 — Audiobook Support
- [ ] M4B chapter extraction via ffprobe
- [ ] MP3 multi-file book detection and ordering
- [ ] Audio streaming endpoints with HTTP Range support
- [ ] AudioEngine singleton (HTMLAudioElement manager)
- [ ] Zustand audio store (playback state, persistent across navigation)
- [ ] AudioMiniPlayer (bottom bar, always visible during playback)
- [ ] AudioFullPlayer (dedicated view with large cover, chapter list)
- [ ] Playback controls (play/pause, skip 30s, speed 0.5x-3.0x, volume)
- [ ] Chapter navigation
- [ ] Sleep timer (client-side)
- [ ] Progress tracking (track + position, debounced sync)
- [ ] Media Session API for lock screen controls
- **Deliverable**: Stream audiobooks with chapter navigation and persistent player
- **Impeccable passes**: Full cycle

### Phase 7 — Device Integration
- [ ] Send-to-Kindle via nodemailer (SMTP config UI, Kindle email config)
- [ ] Format validation (EPUB, PDF, MOBI supported; 50MB limit)
- [ ] Delivery history tracking
- [ ] OPDS 1.2 feed generation (navigation + acquisition feeds)
- [ ] OPDS feed structure: root, recent, by author, by series, by collection, search
- [ ] OpenSearch descriptor
- [ ] OPDS HTTP Basic auth
- [ ] OPDS pagination
- [ ] Metadata export (OPF + JSON sidecar files)
- **Deliverable**: Send books to Kindle, browse library from e-reader apps

### Phase 8 — Polish & Hardening
- [ ] Full Impeccable pass across all views
- [ ] Collections and tagging UI
- [ ] Series grouping view
- [ ] Reverse proxy documentation (nginx, Caddy, Traefik examples)
- [ ] Error handling audit (network failures, corrupt files, API timeouts)
- [ ] Loading states and skeleton screens
- [ ] Offline reader support (service worker for downloaded books)
- [ ] Performance optimization (bundle splitting, lazy loading, image optimization)
- [ ] CI pipeline (GitHub Actions: lint, test, build, Docker publish)
- **Deliverable**: Production-ready, polished application

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Hardcover API is in beta, may break | Metadata enrichment stops working | Pluggable provider interface; add OpenLibrary/Google Books as fallbacks |
| epub.js security (XSS via malicious EPUBs) | Session theft, data exfiltration | Server-side HTML sanitization + CSP `script-src 'none'` + sandbox without `allow-scripts` |
| Large libraries (50k+ books) scan slowly | Poor first-run experience | Incremental scan, file modification time checks, background processing with progress UI |
| M4B chapter extraction requires ffprobe | Adds ~80MB to Docker image | Alpine package, only used for M4B; MP3 uses pure-JS `music-metadata` |
| SQLite write contention under heavy use | Errors during concurrent writes | WAL mode (concurrent reads), single-writer pattern, queue writes via job system |
| Hardcover rate limit (60 req/min) | Slow metadata enrichment for large libraries | Token bucket rate limiter, batch queue, patience — 3,600 books/hour is acceptable |

---

## Verification Plan

After each phase, verify:

1. **Phase 1**: `docker compose up` starts container, `GET /api/health` returns 200, login flow works, auth-protected routes reject unauthenticated requests
2. **Phase 2**: Add a library path in settings, trigger scan, verify books appear in database with correct metadata extraction
3. **Phase 3**: Browse library grid, apply filters, search books, view book detail — test on mobile viewport
4. **Phase 4**: After scan, verify books get Hardcover matches with covers; manually search and correct a mismatch
5. **Phase 5**: Open an EPUB and PDF in browser, navigate pages, change reader settings, close and reopen to verify position restored
6. **Phase 6**: Play an M4B audiobook, navigate chapters, change speed, navigate to another page and verify mini-player persists, close and reopen to verify resume
7. **Phase 7**: Configure SMTP + Kindle email, send a book, verify delivery; access OPDS feed from an e-reader app (KOReader)
8. **Phase 8**: Full E2E walkthrough on desktop and mobile, Lighthouse audit, security review of auth + path validation
