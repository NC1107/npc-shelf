import { Request, Response, NextFunction } from 'express';
import path from 'node:path';

/**
 * Validates that requested file paths don't traverse outside allowed directories.
 */
export function validatePath(allowedRoots: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestedPath = req.query.path as string | undefined;
    if (!requestedPath) {
      next();
      return;
    }

    const resolved = path.resolve(requestedPath);
    const isAllowed = allowedRoots.some((root) => resolved.startsWith(path.resolve(root)));

    if (!isAllowed) {
      res.status(403).json({ error: 'Forbidden', message: 'Path traversal not allowed' });
      return;
    }

    next();
  };
}
