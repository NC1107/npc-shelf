import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

/**
 * HTTP Basic auth for OPDS clients (e-readers like KOReader).
 */
export async function opdsAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="NPC-Shelf OPDS"');
    res.status(401).send('Authentication required');
    return;
  }

  const encoded = authHeader.slice(6);
  const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  const [username, password] = decoded.split(':');

  if (!username || !password) {
    res.status(401).send('Invalid credentials');
    return;
  }

  const user = db.select().from(schema.users).where(eq(schema.users.username, username)).get();

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.setHeader('WWW-Authenticate', 'Basic realm="NPC-Shelf OPDS"');
    res.status(401).send('Invalid credentials');
    return;
  }

  req.user = { userId: user.id, username: user.username, role: user.role };
  next();
}
