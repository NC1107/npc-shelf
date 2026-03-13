import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

const TEST_COVER_DIR = path.join(os.tmpdir(), `npc-shelf-test-covers-${process.pid}`);
const TEST_BOOK_ID = 99999;

// Set env BEFORE importing the module so the module-level constant picks it up
process.env.COVER_CACHE_PATH = TEST_COVER_DIR;

// Dynamic import after env is set
const { extractAndCacheCover, getCoverPath } = await import('../cover.js');

async function createTestPng(): Promise<Buffer> {
  return sharp({
    create: { width: 600, height: 900, channels: 3, background: { r: 128, g: 64, b: 192 } },
  })
    .png()
    .toBuffer();
}

describe('Cover Pipeline', () => {
  beforeAll(() => {
    fs.mkdirSync(TEST_COVER_DIR, { recursive: true });
  });

  afterAll(() => {
    try { fs.rmSync(TEST_COVER_DIR, { recursive: true, force: true }); } catch { /* Windows EPERM */ }
    delete process.env.COVER_CACHE_PATH;
  });

  it('extractAndCacheCover generates original + three WebP sizes', async () => {
    const png = await createTestPng();
    const result = await extractAndCacheCover(png, TEST_BOOK_ID);

    expect(result).toBeTruthy();

    // Check original
    const originalPath = path.join(TEST_COVER_DIR, `${TEST_BOOK_ID}_original`);
    expect(fs.existsSync(originalPath)).toBe(true);

    // Check WebP variants
    for (const size of ['thumb', 'medium', 'full'] as const) {
      const webpPath = path.join(TEST_COVER_DIR, `${TEST_BOOK_ID}_${size}.webp`);
      expect(fs.existsSync(webpPath)).toBe(true);

      const meta = await sharp(webpPath).metadata();
      expect(meta.format).toBe('webp');
    }
  });

  it('thumb is 200px wide', async () => {
    const thumbPath = path.join(TEST_COVER_DIR, `${TEST_BOOK_ID}_thumb.webp`);
    const meta = await sharp(thumbPath).metadata();
    expect(meta.width).toBe(200);
  });

  it('getCoverPath returns correct paths', () => {
    const p = getCoverPath(42, 'thumb');
    expect(p).toContain('42_thumb.webp');
  });
});
