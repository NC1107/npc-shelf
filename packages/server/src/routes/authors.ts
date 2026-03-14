import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, schema, sqlite } from '../db/index.js';
import { stringSimilarity } from '../utils/string-similarity.js';

export const authorsRouter = Router();

// List all authors with book counts, optional ?q= search
authorsRouter.get('/', (req, res) => {
  try {
    const q = (req.query.q as string)?.trim().toLowerCase();
    const allAuthors = db.select().from(schema.authors).orderBy(schema.authors.sortName).all();

    const results = allAuthors
      .filter((a) => !q || a.name.toLowerCase().includes(q) || a.sortName.toLowerCase().includes(q))
      .map((a) => {
        const bookCount =
          db
            .select({ count: sql<number>`count(*)` })
            .from(schema.bookAuthors)
            .where(eq(schema.bookAuthors.authorId, a.id))
            .get()?.count || 0;
        return { ...a, bookCount };
      });

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
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
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

    const books = bookEntries
      .map((entry) => {
        const book = db.select().from(schema.books).where(eq(schema.books.id, entry.bookId)).get();
        if (!book) return null;
        return { ...book, role: entry.role };
      })
      .filter(Boolean);

    res.json({ ...author, books });
  } catch (error) {
    console.error('[Authors] Get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Edit author
authorsRouter.put('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
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
