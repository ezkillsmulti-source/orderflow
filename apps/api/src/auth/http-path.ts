import type { Request } from 'express';

/** Nest's mounted middleware can rewrite req.path; originalUrl retains the route. */
export function isHealthRequest(req: Request): boolean {
  const path = req.originalUrl.split('?')[0]!.replace(/\/+$/, '');
  return path === '/health/live' || path === '/health/ready';
}
