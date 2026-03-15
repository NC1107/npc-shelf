# Book Ingestion Pipeline — Data Flow

This document traces a book from file discovery through metadata matching.

## Pipeline Overview

```
Disk files → Discovery → Directory context → Filename parsing → Grouping
  → Metadata resolution → Persistence (DB) → Metadata matching (Hardcover)
  → Cover pipeline
```

## 1. File Discovery

**`scan-pipeline.ts:discoverFiles()`**

Recursively walks library directories. Collects files matching supported extensions (epub, pdf, mobi, azw3, m4b, mp3). Each file produces a `FileCandidate` with path, filename, extension, size, modified time, and audio flag.

## 2. Directory Context Inference

**`scan-pipeline.ts:inferDirectoryContext()`**

Extracts hints from the directory path:
- Parent directory → likely author name
- Current directory → likely title or series
- Sidecar files (metadata.opf, cover.jpg) → additional metadata

## 3. Filename Parsing

**`filename-parser.ts:parseFilenameEnhanced()`**

1. Strip extension
2. **Dot detection**: If filename has 3+ dots and no spaces, convert dots to spaces, normalize bare hyphens to spaced dashes
3. Extract leading track numbers (`001 - Title.m4b`)
4. Extract `[Series NN] -` bracket prefix
5. Run `cleanTitle()` to strip artifacts:
   - Format suffixes: `(azw3)`, `(epub)`, `(mobi)`, etc.
   - Release tags: `(retail)`, `(US)`, `(UK)`, `(v5.0)`
   - Bracket prefixes: `[Series NN] -`
   - Year prefixes: `(1941)`
   - Scene group tags: `eBook-XXX`
   - Standalone format words: `RETAIL`, `EPUB`, `AZW3`, etc.
6. Parse `Author - Title` pattern using `resolveAuthorTitle()`:
   - Directory hint takes priority (matches parent dir name)
   - Person-name heuristic (2-4 words, no digits/special chars)
   - Default: left = author, right = title

## 4. File Grouping

**`scan-pipeline.ts:groupIntoCandidates()`**

Groups files into `BookCandidate` objects by normalized title within each directory. Multi-file audiobooks (same directory, sequential tracks) group into a single candidate.

## 5. Metadata Resolution

**`scan-pipeline.ts:resolveMetadata()`**

Priority merge of metadata sources:
1. **Sidecar** (metadata.opf) — highest priority
2. **Directory hints** — author from parent dir, series from dir name
3. **Filename hints** — parsed title, author, series

Produces `resolvedTitle`, `resolvedAuthor`, `resolvedSeries`, `resolvedSeriesList`.

## 6. Persistence

**`scanner.ts:persistCandidate()`**

1. Check for existing files in DB (skip if unchanged)
2. Extract embedded metadata from primary file:
   - **EPUB**: JSZip + fast-xml-parser for OPF (title, author, description, ISBN, cover)
   - **MP3/M4B**: music-metadata (title, artist, album, duration, chapters, cover)
3. **Title validation**: If embedded title equals author name, reject it and use filename-parsed title
4. Compute file hashes (SHA-256, parallelized; partial hash for large audio)
5. Insert/update book, files, authors, series, tags in DB
6. Handle cover: sidecar cover > embedded cover > none

### Title Resolution Decision Tree

```
embedded.title exists?
  ├─ YES → equals author name?
  │   ├─ YES → use candidate.resolvedTitle (from filename/directory)
  │   └─ NO  → use embedded.title
  └─ NO  → use candidate.resolvedTitle
```

## 7. Metadata Matching

**`metadata-pipeline.ts:enrichBook()`**

1. **Clean title**: Run `cleanTitle()` on stored title
2. **Dirty title check**: If title equals author name, has format artifacts, or bracket prefixes:
   - Fetch first file's filename from DB
   - Run `parseFilename()` on it to extract a search title
   - Use filename title instead of stored title
3. **Search Hardcover** (priority order):
   - **ISBN search** (`searchByIsbn`) — highest confidence (0.9)
   - **Title+Author search** (`searchByTitle`) — scored by bigram similarity
4. **Score results**:
   - Title similarity (bigram Jaccard) × weight (0.6 with author, 0.8 without)
   - Author similarity × weight (0.4 with author, 0 without)
   - Length penalty when ratio < 0.4
   - Hard floor: title similarity < 0.3 → reject
   - Title gate: title similarity < 0.5 → reject
   - Confidence threshold: combined < 0.3 → reject
5. **Fetch details** via `books_by_pk` for slug, all series, and canonical title
6. **Apply match**:
   - Always set: hardcoverId, hardcoverSlug, matchConfidence, matchBreakdown
   - Only if empty: description, publishDate, isbn13, pageCount, isbn10
   - **Canonical title** from `books_by_pk` replaces dirty titles (not search result title, which may be an omnibus variant)
7. **Download cover** if missing
8. **Create series** relationships (all series from `books_by_pk`)
9. **Enrich authors** (bio, photo from Hardcover)
10. **Cache raw metadata** and create tags

### Title Fix Decision Tree (in enrichBook)

```
isDirtyTitle(book.title)?
  ├─ YES → extract title from filename
  │   ├─ filename title ≠ author → use as searchTitle
  │   └─ filename title = author → use cleaned book.title (best effort)
  │   After match: use canonical title from getDetails() for DB update
  └─ NO  → use cleanTitle(book.title) as searchTitle
```

## 8. Cover Pipeline

**`cover.ts:extractAndCacheCover()` / `downloadAndResizeCover()`**

1. Validate image format via `sharp().metadata()`
2. Save original to `{id}_original`
3. Generate WebP resizes:
   - `{id}_thumb.webp` — 200px wide
   - `{id}_medium.webp` — 400px wide
   - `{id}_full.webp` — 800px wide
4. Store cover path in DB

Cover sources (priority):
1. Hardcover API (during metadata matching)
2. Sidecar cover file (during scanning)
3. Embedded cover in EPUB/audio (during scanning)

## 9. Background Jobs

The job queue (SQLite-backed, polled every 5s) handles:
- `scan_library` — triggers the full pipeline above
- `match_metadata` — enrichBook for a single book
- `match_all_metadata` — enrichBook for all unmatched books
- `backfill_covers` — regenerate missing WebP variants
- `cleanup_titles` — fix dirty titles on matched + unmatched books
- `merge_audiobook` — ffmpeg concat of multi-file audiobooks
- `convert_format` — Calibre ebook-convert
