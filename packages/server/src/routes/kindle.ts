import { Router } from 'express';
import { eq, sql, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { sendToKindle } from '../services/kindle.js';
import fs from 'node:fs';

export const kindleRouter = Router();

// Send book to Kindle
kindleRouter.post('/send/:bookId', async (req, res) => {
  try {
    const bookId = parseInt(req.params.bookId);
    const userId = req.user!.userId;

    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    // Get Kindle email
    const kindleConfig = db
      .select()
      .from(schema.kindleSettings)
      .where(eq(schema.kindleSettings.userId, userId))
      .get();

    if (!kindleConfig?.kindleEmail) {
      res.status(400).json({ error: 'Kindle email not configured' });
      return;
    }

    // Get SMTP config
    const getSettings = (key: string) =>
      db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value || '';

    const smtpConfig = {
      host: getSettings('smtpHost'),
      port: parseInt(getSettings('smtpPort') || '587'),
      user: getSettings('smtpUser'),
      pass: getSettings('smtpPass'),
      from: getSettings('fromEmail'),
    };

    if (!smtpConfig.host || !smtpConfig.user) {
      res.status(400).json({ error: 'SMTP settings not configured' });
      return;
    }

    // Find a supported file (prefer epub, then pdf, then mobi)
    const files = db.select().from(schema.files).where(eq(schema.files.bookId, bookId)).all();
    const supportedFormats = ['epub', 'pdf', 'mobi'];
    const file = supportedFormats
      .map((fmt) => files.find((f) => f.format === fmt))
      .find((f) => f && fs.existsSync(f.path));

    if (!file) {
      res.status(400).json({ error: 'No supported file found for Kindle delivery' });
      return;
    }

    // Record delivery attempt
    const delivery = db
      .insert(schema.kindleDeliveries)
      .values({
        userId,
        bookId,
        kindleEmail: kindleConfig.kindleEmail,
        status: 'pending',
        fileFormat: file.format,
        fileSizeBytes: file.sizeBytes,
      })
      .returning()
      .get();

    // Send asynchronously
    sendToKindle(file.path, kindleConfig.kindleEmail, smtpConfig)
      .then((result) => {
        db.update(schema.kindleDeliveries)
          .set({ status: 'sent', messageId: result.messageId })
          .where(eq(schema.kindleDeliveries.id, delivery.id))
          .run();
      })
      .catch((err) => {
        db.update(schema.kindleDeliveries)
          .set({ status: 'failed', error: err.message })
          .where(eq(schema.kindleDeliveries.id, delivery.id))
          .run();
      });

    res.json({ message: 'Sending to Kindle...', deliveryId: delivery.id });
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

    const getSettings = (key: string) =>
      db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value || '';

    res.json({
      kindleEmail: settings?.kindleEmail || '',
      smtpHost: getSettings('smtpHost'),
      smtpPort: parseInt(getSettings('smtpPort') || '587'),
      smtpUser: getSettings('smtpUser'),
      fromEmail: getSettings('fromEmail'),
      configured: !!(getSettings('smtpHost') && getSettings('smtpUser')),
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
    const smtpSettings: Record<string, string | undefined> = {
      smtpHost,
      smtpPort: smtpPort?.toString(),
      smtpUser,
      smtpPass,
      fromEmail,
    };
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
      .orderBy(desc(schema.kindleDeliveries.createdAt))
      .all();
    res.json(deliveries);
  } catch (error) {
    console.error('[Kindle] History error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
