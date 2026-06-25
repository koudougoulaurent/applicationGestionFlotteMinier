import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error & { status?: number; code?: string },
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error(err);

  // PostgreSQL unique violation
  if (err.code === '23505') {
    res.status(409).json({ error: 'Record already exists' });
    return;
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    res.status(400).json({ error: 'Referenced record does not exist' });
    return;
  }

  const status = err.status || 500;
  const message = status < 500 ? err.message : 'Internal server error';

  res.status(status).json({ error: message });
}

export function notFound(req: Request, res: Response): void {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
}
