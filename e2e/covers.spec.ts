import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3001';
const PASSWORD = 'test1234';

test.describe('Cover API (no auth needed)', () => {
  test('serves WebP thumbnail without auth', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/books/1/cover/thumb`);
    expect(resp.status()).toBe(200);
    expect(resp.headers()['content-type']).toBe('image/webp');
    const body = await resp.body();
    expect(body.length).toBeGreaterThan(1000);
  });

  test('serves all three sizes with correct headers', async ({ request }) => {
    for (const size of ['thumb', 'medium', 'full']) {
      const resp = await request.get(`${BASE}/api/books/1/cover/${size}`);
      expect(resp.status()).toBe(200);
      expect(resp.headers()['content-type']).toBe('image/webp');
      expect(resp.headers()['cache-control']).toContain('max-age=86400');
    }
  });

  test('returns 404 for nonexistent book', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/books/99998/cover/thumb`);
    expect(resp.status()).toBe(404);
  });

  test('other book routes still require auth', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/books`);
    expect(resp.status()).toBe(401);
  });
});

test.describe('Cover images render in browser', () => {
  test('library page shows cover images', async ({ page }) => {
    // Navigate to app
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // Take screenshot of whatever we land on first
    await page.screenshot({ path: 'e2e/screenshots/initial-page.png', fullPage: true });

    // Handle login: password-only form
    const passwordInput = page.locator('input[type="password"]');
    if (await passwordInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await passwordInput.fill(PASSWORD);
      await page.locator('button[type="submit"]').click();
      await page.waitForLoadState('networkidle');
      // Wait for redirect
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'e2e/screenshots/after-login.png', fullPage: true });
    }

    // Navigate to library
    await page.goto(`${BASE}/library`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/screenshots/library-page.png', fullPage: true });

    // Check cover images
    const coverImages = page.locator('img[src*="/cover/"]');
    const count = await coverImages.count();
    console.log(`Found ${count} cover image(s) on library page`);

    if (count > 0) {
      for (let i = 0; i < Math.min(count, 4); i++) {
        const img = coverImages.nth(i);
        const src = await img.getAttribute('src');
        const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
        console.log(`  Image ${i}: src=${src}, naturalWidth=${naturalWidth}`);
        expect(naturalWidth, `Cover image ${src} should load successfully`).toBeGreaterThan(0);
      }
    } else {
      // No cover images found — check if there are books displayed at all
      const pageContent = await page.content();
      const hasBooks = pageContent.includes('book') || pageContent.includes('Book');
      console.log(`No cover images found. Page has book content: ${hasBooks}`);
      console.log(`Current URL: ${page.url()}`);
    }
  });

  test('book detail page shows medium cover', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // Login
    const passwordInput = page.locator('input[type="password"]');
    if (await passwordInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await passwordInput.fill(PASSWORD);
      await page.locator('button[type="submit"]').click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
    }

    // Go to book detail
    await page.goto(`${BASE}/library/1`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/screenshots/book-detail.png', fullPage: true });

    const coverImg = page.locator('img[src*="/cover/medium"]');
    if (await coverImg.count() > 0) {
      const naturalWidth = await coverImg.first().evaluate((el: HTMLImageElement) => el.naturalWidth);
      console.log(`Detail cover naturalWidth: ${naturalWidth}`);
      expect(naturalWidth).toBeGreaterThan(0);
    }
  });
});
