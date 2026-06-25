import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

function formatErrors(error: { issues?: Array<{ path: (string|number)[]; message: string }> }) {
  return (error.issues || []).map((e) => ({
    field:   e.path.join('.') || 'body',
    message: e.message,
  }));
}

// Returns a middleware that validates req.body against a Zod schema
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: formatErrors(result.error as Parameters<typeof formatErrors>[0]) });
      return;
    }
    req.body = result.data;
    next();
  };
}

// Returns a middleware that validates req.query against a Zod schema
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: formatErrors(result.error as Parameters<typeof formatErrors>[0]) });
      return;
    }
    next();
  };
}
