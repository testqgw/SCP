import type { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function verifyAuth(req: Request, _res: Response, next: NextFunction) {
  if (process.env.NODE_ENV !== 'production') {
    req.userId = process.env.DEV_USER_ID ?? 'dev-user-id-123';
    return next();
  }
  return next();
}