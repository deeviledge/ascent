import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { admin } from './routes/admin';
import { webhook } from './routes/webhook';
import type { AppEnv, Bindings } from './types';

const app = new Hono<AppEnv>();

// 管理画面は別オリジン（Vercel / Pages）に置くので CORS を通す。
app.use('/api/*', async (c, next) => {
  const allowed = c.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    allowMethods: ['GET', 'PUT', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })(c, next);
});

app.get('/health', (c) => c.json({ ok: true }));

app.route('/', webhook);
app.route('/', admin);

app.notFound((c) => c.json({ error: 'not found' }, 404));

app.onError((error, c) => {
  console.error('unhandled error', error instanceof Error ? error.stack : String(error));
  return c.json({ error: 'internal error' }, 500);
});

export default {
  fetch: app.fetch,

  /** 冪等化テーブルは放っておくと増え続けるので、日次で古い行を落とす。 */
  async scheduled(_event: ScheduledEvent, env: Bindings): Promise<void> {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    await env.DB.prepare('DELETE FROM processed_events WHERE created_at < ?').bind(cutoff).run();
  },
};
