import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export const settingsRouter = Router();

// Get settings
settingsRouter.get('/', (_req, res) => {
  try {
    const rows = db.select().from(schema.settings).all();
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (error) {
    console.error('[Settings] Get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update settings
settingsRouter.put('/', (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      res.status(400).json({ error: 'Settings object required' });
      return;
    }

    for (const [key, value] of Object.entries(updates)) {
      db.insert(schema.settings)
        .values({ key, value: String(value) })
        .onConflictDoUpdate({
          target: schema.settings.key,
          set: { value: String(value), updatedAt: new Date().toISOString() },
        })
        .run();
    }

    res.json({ message: 'Settings updated' });
  } catch (error) {
    console.error('[Settings] Update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
