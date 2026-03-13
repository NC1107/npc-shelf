# NPC-Shelf

Self-hosted book library for ebooks and audiobooks. Scan your library, read EPUBs and PDFs in the browser, listen to audiobooks, and send books to your Kindle.

## Features

- **Library scanning** — Point at directories of EPUBs, PDFs, M4Bs, and MP3s. NPC-Shelf indexes files, extracts metadata, and generates cover thumbnails.
- **EPUB & PDF reader** — Read in the browser with adjustable font, theme (light/dark/sepia), and progress tracking.
- **Audiobook player** — Stream M4B/MP3 with chapter navigation, playback speed, sleep timer, and persistent mini-player.
- **Metadata matching** — Enriches books from Hardcover with descriptions, covers, series info, page counts, and tags.
- **Send to Kindle** — Email books to your Kindle via SMTP.
- **OPDS catalog** — Access your library from any OPDS-compatible reader app.
- **Search** — Full-text search powered by SQLite FTS5.

## Quick Start (Docker)

```bash
docker run -d \
  --name npc-shelf \
  -p 3000:3000 \
  -v npc-shelf-data:/data \
  -v npc-shelf-cache:/cache \
  -v /path/to/your/books:/libraries/books:ro \
  -e JWT_SECRET=change-this-to-something-secure \
  ghcr.io/nc1107/npc-shelf:latest
```

Then open `http://localhost:3000`, set a password, add your library path, and scan.

### Docker Compose

```yaml
services:
  npc-shelf:
    image: ghcr.io/nc1107/npc-shelf:latest
    container_name: npc-shelf
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - npc-shelf-data:/data
      - npc-shelf-cache:/cache
      # Mount your library directories (read-only recommended)
      - /path/to/ebooks:/libraries/ebooks:ro
      - /path/to/audiobooks:/libraries/audiobooks:ro
    environment:
      - JWT_SECRET=change-this-to-something-secure
      # - CORS_ORIGIN=https://your-domain.com

volumes:
  npc-shelf-data:
  npc-shelf-cache:
```

## Setup

1. Open the app and create a password (first-run setup).
2. Go to **Settings** and add a library path (the path inside the container, e.g. `/libraries/ebooks`).
3. Click **Scan** to index your books.

### Kindle (optional)

To send books to your Kindle, go to **Settings > Kindle** and configure:

| Field | Value |
|---|---|
| Kindle Email | `yourname@kindle.com` (from Amazon > Devices) |
| SMTP Host | e.g. `smtp.gmail.com` |
| SMTP Port | `587` |
| SMTP User | Your email address |
| SMTP Password | App password (not your regular password) |
| From Email | Same as SMTP user |

You must also add your From Email to Amazon's [Approved Personal Document Email List](https://www.amazon.com/hz/mycd/myx#/home/settings/pdoc).

### Hardcover Metadata (optional)

For automatic metadata enrichment, add a [Hardcover](https://hardcover.app) API token in **Settings > Metadata**.

## Development

```bash
git clone https://github.com/NC1107/npc-shelf.git
cd npc-shelf
npm install
npm run build:shared

# Terminal 1: server (port 3001)
npm run dev:server

# Terminal 2: client (port 5173, proxies API to 3001)
npm run dev:client
```

### Commands

| Command | Description |
|---|---|
| `npm run build` | Build all packages (shared, client, server) |
| `npm test` | Run unit tests |
| `npm run dev:server` | Start dev server with hot reload |
| `npm run dev:client` | Start Vite dev server |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server port |
| `DATABASE_PATH` | `./data/npc-shelf.db` | SQLite database path |
| `COVER_CACHE_PATH` | `./cache/covers` | Cover image cache |
| `JWT_SECRET` | dev default | **Change in production** |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed CORS origin |

## Tech Stack

TypeScript monorepo — Express.js, SQLite (Drizzle ORM), React 19, Vite, TanStack Router/Query, Tailwind v4, shadcn/ui.

## License

MIT
