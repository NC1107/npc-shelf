import { Router } from 'express';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  type JwtPayload,
} from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rate-limit.js';
import { AUTH } from '@npc-shelf/shared';

export const authRouter = Router();

// First-run setup — create admin user
authRouter.post('/setup', authRateLimit, async (req, res) => {
  try {
    const setupComplete = db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, 'setupComplete'))
      .get();

    if (setupComplete?.value === 'true') {
      res.status(400).json({ error: 'Setup already complete' });
      return;
    }

    const { password } = req.body;
    if (!password || typeof password !== 'string' || password.length < AUTH.MIN_PASSWORD_LENGTH) {
      res.status(400).json({
        error: 'Password must be at least ' + AUTH.MIN_PASSWORD_LENGTH + ' characters',
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, AUTH.BCRYPT_ROUNDS);

    const user = db
      .insert(schema.users)
      .values({
        username: 'admin',
        passwordHash,
        role: 'admin',
      })
      .returning()
      .get();

    // Mark setup as complete
    db.update(schema.settings)
      .set({ value: 'true', updatedAt: new Date().toISOString() })
      .where(eq(schema.settings.key, 'setupComplete'))
      .run();

    const payload: JwtPayload = { userId: user.id, username: user.username, role: user.role };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: AUTH.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      path: '/api/auth',
    });

    res.json({ accessToken, expiresIn: 900, user: { id: user.id, username: user.username, role: user.role } });
  } catch (error) {
    console.error('[Auth] Setup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check if setup is needed
authRouter.get('/setup/status', (_req, res) => {
  const setupComplete = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, 'setupComplete'))
    .get();

  res.json({ setupRequired: setupComplete?.value !== 'true' });
});

// Login
authRouter.post('/auth/login', authRateLimit, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      res.status(400).json({ error: 'Password is required' });
      return;
    }

    // MVP: single user, get the admin
    const user = db.select().from(schema.users).where(eq(schema.users.role, 'admin')).get();

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }

    const payload: JwtPayload = { userId: user.id, username: user.username, role: user.role };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: AUTH.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      path: '/api/auth',
    });

    res.json({ accessToken, expiresIn: 900, user: { id: user.id, username: user.username, role: user.role } });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Refresh token
authRouter.post('/auth/refresh', (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      res.status(401).json({ error: 'No refresh token' });
      return;
    }

    const payload = verifyRefreshToken(refreshToken);
    const newPayload: JwtPayload = {
      userId: payload.userId,
      username: payload.username,
      role: payload.role,
    };

    const accessToken = generateAccessToken(newPayload);
    const newRefreshToken = generateRefreshToken(newPayload);

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: AUTH.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      path: '/api/auth',
    });

    res.json({ accessToken, expiresIn: 900 });
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Logout
authRouter.post('/auth/logout', (_req, res) => {
  res.clearCookie('refreshToken', { path: '/api/auth' });
  res.json({ message: 'Logged out' });
});
