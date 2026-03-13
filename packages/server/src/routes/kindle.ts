import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export const kindleRouter = Router();

// Send book to Kindle
kindleRouter.post('/send/:bookId', (req, res) => {
  try {
    const bookId = parseInt(req.params.bookId);
    const userId = req.user!.userId;

    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    // Check Kindle settings
    const kindleConfig = db
      .select()
      .from(schema.kindleSettings)
      .where(eq(schema.kindleSettings.userId, userId))
      .get();

    if (!kindleConfig) {
      res.status(400).json({ error: 'Kindle email not configured' });
      return;
    }

    // TODO: Implement actual email sending via nodemailer
    res.json({ message: 'Send to Kindle queued', bookId });
  } catch (error) {
    console.error('[Kindle] Send error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Kindle settings
kindleRouter.get('/settings', (req, res) => {
  try {
    const userId = req.user!.userId;
    const settings = db
      .select()
      .from(schema.kindleSettings)
      .where(eq(schema.kindleSettings.userId, userId))
      .get();

    // Get SMTP settings from app settings
    const smtpHost = db.select().from(schema.settings).where(eq(schema.settings.key, 'smtpHost')).get();
    const smtpPort = db.select().from(schema.settings).where(eq(schema.settings.key, 'smtpPort')).get();
    const smtpUser = db.select().from(schema.settings).where(eq(schema.settings.key, 'smtpUser')).get();
    const fromEmail = db.select().from(schema.settings).where(eq(schema.settings.key, 'fromEmail')).get();

    res.json({
      kindleEmail: settings?.kindleEmail || '',
      smtpHost: smtpHost?.value || '',
      smtpPort: smtpPort?.value ? parseInt(smtpPort.value) : 587,
      smtpUser: smtpUser?.value || '',
      fromEmail: fromEmail?.value || '',
    });
  } catch (error) {
    console.error('[Kindle] Settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update Kindle settings
kindleRouter.put('/settings', (req, res) => {
  try {
    const userId = req.user!.userId;
    const { kindleEmail, smtpHost, smtpPort, smtpUser, smtpPass, fromEmail } = req.body;

    // Update Kindle email
    if (kindleEmail !== undefined) {
      const existing = db
        .select()
        .from(schema.kindleSettings)
        .where(eq(schema.kindleSettings.userId, userId))
        .get();

      if (existing) {
        db.update(schema.kindleSettings)
          .set({ kindleEmail })
          .where(eq(schema.kindleSettings.id, existing.id))
          .run();
      } else {
        db.insert(schema.kindleSettings).values({ userId, kindleEmail }).run();
      }
    }

    // Update SMTP settings
    const smtpSettings = { smtpHost, smtpPort: smtpPort?.toString(), smtpUser, smtpPass, fromEmail };
    for (const [key, value] of Object.entries(smtpSettings)) {
      if (value !== undefined) {
        db.insert(schema.settings)
          .values({ key, value })
          .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date().toISOString() } })
          .run();
      }
    }

    res.json({ message: 'Settings updated' });
  } catch (error) {
    console.error('[Kindle] Update settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delivery history
kindleRouter.get('/history', (req, res) => {
  try {
    const userId = req.user!.userId;
    const deliveries = db
      .select()
      .from(schema.kindleDeliveries)
      .where(eq(schema.kindleDeliveries.userId, userId))
      .all();
    res.json(deliveries);
  } catch (error) {
    console.error('[Kindle] History error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
