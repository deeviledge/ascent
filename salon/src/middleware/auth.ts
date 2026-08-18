import type { MiddlewareHandler } from 'hono';
import { verifyToken } from '../lib/crypto';
import type { AppEnv, Session } from '../types';

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  const payload = await verifyToken<Session & { exp: number }>(token, c.env.AUTH_SECRET);
  if (!payload) return c.json({ error: 'unauthorized' }, 401);

  c.set('session', { userId: payload.userId, tenantId: payload.tenantId, email: payload.email });
  await next();
};
