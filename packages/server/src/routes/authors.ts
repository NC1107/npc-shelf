import { Router } from 'express';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema, sqlite } from '../db/index.js';
import { stringSimilarity } from '../utils/string-similarity.js';
import { normalizeAuthorName } from '../utils/author-utils.js';
import { getProvider } from '../services/metadata-pipeline.js';
import { toSortName } from '../utils/filename-parser.js';

export const authorsRouter = Router();

// List all authors with book counts, optional ?q= search
authorsRouter.get('/', (req, res) => {
  try {
    const q = (req.query.q as string)?.trim().toLowerCase();
    const allAuthors = db.select().from(schema.authors).orderBy(schema.authors.sortName).all();

    // Single GROUP BY query for all book counts
    const bookCountRows = db
      .all<{ authorId: number; count: number }>(
        sql`SELECT author_id as authorId, COUNT(*) as count FROM book_authors GROUP BY author_id`,
      );
    const bookCountMap = new Map(bookCountRows.map((r) => [r.authorId, r.count]));

    const results = allAuthors
      .filter((a) => !q || a.name.toLowerCase().includes(q) || a.sortName.toLowerCase().includes(q))
      .map((a) => ({ ...a, bookCount: bookCountMap.get(a.id) || 0 }));

    res.json(results);
  } catch (error) {
    console.error('[Authors] List error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Detect potential duplicate authors
authorsRouter.get('/duplicates', (_req, res) => {
  try {
    const allAuthors = db.select().from(schema.authors).all();
    const groups: Array<{ authors: typeof allAuthors; similarity: number }> = [];
    const seen = new Set<number>();

    for (let i = 0; i < allAuthors.length; i++) {
      if (seen.has(allAuthors[i].id)) continue;
      const group = [allAuthors[i]];
      let maxSim = 0;

      const nameA = allAuthors[i].name.toLowerCase().trim();
      // Generate flipped sort name: "Last, First" -> "first last"
      const flipA = allAuthors[i].sortName
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .reverse()
        .join(' ');

      for (let j = i + 1; j < allAuthors.length; j++) {
        if (seen.has(allAuthors[j].id)) continue;

        const nameB = allAuthors[j].name.toLowerCase().trim();
        const flipB = allAuthors[j].sortName
          .split(',')
          .map((p) => p.trim().toLowerCase())
          .reverse()
          .join(' ');

        const sim = stringSimilarity(nameA, nameB);
        const flipSim = Math.max(
          stringSimilarity(nameA, flipB),
          stringSimilarity(flipA, nameB),
        );
        const best = Math.max(sim, flipSim);

        if (best >= 0.8) {
          group.push(allAuthors[j]);
          seen.add(allAuthors[j].id);
          maxSim = Math.max(maxSim, best);
        }
      }

      if (group.length > 1) {
        seen.add(allAuthors[i].id);
        groups.push({ authors: group, similarity: Math.round(maxSim * 1000) / 1000 });
        if (groups.length >= 50) break;
      }
    }

    res.json(groups);
  } catch (error) {
    console.error('[Authors] Duplicates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get author detail with books
authorsRouter.get('/:id', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid author ID' });
      return;
    }

    const author = db.select().from(schema.authors).where(eq(schema.authors.id, id)).get();
    if (!author) {
      res.status(404).json({ error: 'Author not found' });
      return;
    }

    const bookEntries = db
      .select({
        bookId: schema.bookAuthors.bookId,
        role: schema.bookAuthors.role,
      })
      .from(schema.bookAuthors)
      .where(eq(schema.bookAuthors.authorId, id))
      .all();

    const bookIds = bookEntries.map((e) => e.bookId);
    const roleByBookId = new Map(bookEntries.map((e) => [e.bookId, e.role]));

    const rawBooks = bookIds.length > 0
      ? db
          .select()
          .from(schema.books)
          .where(inArray(schema.books.id, bookIds))
          .all()
      : [];

    const books = rawBooks.map((book) => ({ ...book, role: roleByBookId.get(book.id) }));

    res.json({ ...author, books });
  } catch (error) {
    console.error('[Authors] Get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Edit author
authorsRouter.put('/:id', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid author ID' });
      return;
    }

    const existing = db.select().from(schema.authors).where(eq(schema.authors.id, id)).get();
    if (!existing) {
      res.status(404).json({ error: 'Author not found' });
      return;
    }

    const { name, sortName, bio, photoUrl } = req.body;
    const updates: Record<string, string> = {};
    if (name !== undefined) updates.name = name;
    if (sortName !== undefined) updates.sortName = sortName;
    if (bio !== undefined) updates.bio = bio;
    if (photoUrl !== undefined) updates.photoUrl = photoUrl;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    db.update(schema.authors).set(updates).where(eq(schema.authors.id, id)).run();

    const updated = db.select().from(schema.authors).where(eq(schema.authors.id, id)).get();
    res.json(updated);
  } catch (error) {
    console.error('[Authors] Update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Merge authors: reassign books from source authors to target, delete sources
authorsRouter.post('/merge', (req, res) => {
  try {
    const { sourceIds, targetId } = req.body as { sourceIds: number[]; targetId: number };

    if (!Array.isArray(sourceIds) || sourceIds.length === 0 || typeof targetId !== 'number') {
      res.status(400).json({ error: 'Invalid request: sourceIds (array) and targetId (number) required' });
      return;
    }

    const target = db.select().from(schema.authors).where(eq(schema.authors.id, targetId)).get();
    if (!target) {
      res.status(404).json({ error: 'Target author not found' });
      return;
    }

    const merge = sqlite.transaction(() => {
      for (const sourceId of sourceIds) {
        if (sourceId === targetId) continue;

        // Get all book-author links for this source
        const links = db
          .select()
          .from(schema.bookAuthors)
          .where(eq(schema.bookAuthors.authorId, sourceId))
          .all();

        for (const link of links) {
          // Try to insert with target author; ignore if composite PK already exists
          db.insert(schema.bookAuthors)
            .values({ bookId: link.bookId, authorId: targetId, role: link.role })
            .onConflictDoNothing()
            .run();
        }

        // Delete source book-author links, then the source author
        db.delete(schema.bookAuthors).where(eq(schema.bookAuthors.authorId, sourceId)).run();
        db.delete(schema.authors).where(eq(schema.authors.id, sourceId)).run();
      }

      return db.select().from(schema.authors).where(eq(schema.authors.id, targetId)).get();
    });

    const result = merge();
    res.json({ merged: result, removedIds: sourceIds.filter((id) => id !== targetId) });
  } catch (error) {
    console.error('[Authors] Merge error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Auto-dedup: normalize all names, group duplicates, merge into the one with most books
authorsRouter.post('/auto-dedup', (_req, res) => {
  try {
    const allAuthors = db.select().from(schema.authors).all();

    // Get book counts
    const bookCountRows = db
      .all<{ authorId: number; count: number }>(
        sql`SELECT author_id as authorId, COUNT(*) as count FROM book_authors GROUP BY author_id`,
      );
    const bookCountMap = new Map(bookCountRows.map((r) => [r.authorId, r.count]));

    // Group by normalized name
    const groups = new Map<string, typeof allAuthors>();
    for (const author of allAuthors) {
      const normalized = normalizeAuthorName(author.name).toLowerCase();
      const existing = groups.get(normalized);
      if (existing) {
        existing.push(author);
      } else {
        groups.set(normalized, [author]);
      }
    }

    let merged = 0;
    let groupCount = 0;

    const doMerge = sqlite.transaction(() => {
      for (const [, group] of groups) {
        if (group.length <= 1) continue;
        groupCount++;

        // Pick the author with the most books as target
        const sorted = [...group].sort((a, b) =>
          (bookCountMap.get(b.id) || 0) - (bookCountMap.get(a.id) || 0),
        );
        const target = sorted[0];

        for (let i = 1; i < sorted.length; i++) {
          const source = sorted[i];

          // Reassign book-author links
          const links = db
            .select()
            .from(schema.bookAuthors)
            .where(eq(schema.bookAuthors.authorId, source.id))
            .all();

          for (const link of links) {
            db.insert(schema.bookAuthors)
              .values({ bookId: link.bookId, authorId: target.id, role: link.role })
              .onConflictDoNothing()
              .run();
          }

          db.delete(schema.bookAuthors).where(eq(schema.bookAuthors.authorId, source.id)).run();
          db.delete(schema.authors).where(eq(schema.authors.id, source.id)).run();
          merged++;
        }
      }
    });

    doMerge();

    res.json({ merged, groups: groupCount });
  } catch (error) {
    console.error('[Authors] Auto-dedup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search Hardcover for an author by name
authorsRouter.get('/search-hardcover', async (req, res) => {
  try {
    const q = (req.query.q as string)?.trim();
    if (!q) {
      res.status(400).json({ error: 'Query parameter q is required' });
      return;
    }

    const provider = getProvider();
    const results = await provider.searchAuthorByName(q);
    res.json(results);
  } catch (error) {
    console.error('[Authors] Hardcover search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Link a local author to a Hardcover canonical record
authorsRouter.post('/:id/link-hardcover', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid author ID' });
      return;
    }

    const { hardcoverId } = req.body;
    if (!hardcoverId) {
      res.status(400).json({ error: 'hardcoverId is required' });
      return;
    }

    const existing = db.select().from(schema.authors).where(eq(schema.authors.id, id)).get();
    if (!existing) {
      res.status(404).json({ error: 'Author not found' });
      return;
    }

    const provider = getProvider();
    const details = await provider.getAuthorDetails(String(hardcoverId));
    if (!details) {
      res.status(404).json({ error: 'Hardcover author not found' });
      return;
    }

    db.update(schema.authors)
      .set({
        name: details.name,
        sortName: toSortName(details.name),
        hardcoverId: String(details.id),
        bio: details.bio || existing.bio,
        photoUrl: details.imageUrl || existing.photoUrl,
      })
      .where(eq(schema.authors.id, id))
      .run();

    const updated = db.select().from(schema.authors).where(eq(schema.authors.id, id)).get();
    res.json(updated);
  } catch (error) {
    console.error('[Authors] Link Hardcover error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
