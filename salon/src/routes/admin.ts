import { Hono } from 'hono';
import { encryptSecret, hashPassword, newId, signToken, verifyPassword } from '../lib/crypto';
import { getTenantById, getUsage } from '../lib/db';
import { monthKeyJst } from '../lib/time';
import { requireAuth } from '../middleware/auth';
import type { AppEnv, Tenant } from '../types';

const SESSION_TTL_SECONDS = 60 * 60 * 12;

export const admin = new Hono<AppEnv>();

admin.use('/api/*', async (c, next) => {
  // 認証前に通す必要があるのはサインアップとログインだけ。
  if (c.req.path.startsWith('/api/auth/')) return next();
  return requireAuth(c, next);
});

/** LINE トークンなどの秘匿値は、有無だけ返して中身は返さない。 */
function publicTenant(tenant: Tenant, origin: string) {
  return {
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,
    forward_enabled: tenant.forward_enabled === 1,
    ai_enabled: tenant.ai_enabled === 1,
    ai_quota_monthly: tenant.ai_quota_monthly,
    business_hours: tenant.business_hours,
    menu_text: tenant.menu_text,
    faq_text: tenant.faq_text,
    ng_keywords: tenant.ng_keywords,
    staff_group_id: tenant.staff_group_id,
    line_connected: Boolean(tenant.line_channel_secret && tenant.line_access_token),
    line_bot_user_id: tenant.line_bot_user_id,
    webhook_url: `${origin}/line/webhook/${tenant.id}`,
  };
}

admin.post('/api/auth/signup', async (c) => {
  const body = await c.req.json<{ salon_name?: string; email?: string; password?: string }>();
  const salonName = body.salon_name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? '';

  if (!salonName || !email || password.length < 8) {
    return c.json({ error: 'サロン名・メールアドレス・8文字以上のパスワードが必要です' }, 400);
  }

  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) return c.json({ error: 'このメールアドレスは登録済みです' }, 409);

  const now = Date.now();
  const tenantId = newId('ten');
  const userId = newId('usr');
  const quota = Number(c.env.DEFAULT_AI_QUOTA) || 300;

  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO tenants (id, name, status, ai_quota_monthly, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(tenantId, salonName, 'trial', quota, now, now),
    c.env.DB.prepare(
      'INSERT INTO users (id, tenant_id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(userId, tenantId, email, await hashPassword(password), 'owner', now),
  ]);

  const token = await signToken({ userId, tenantId, email }, c.env.AUTH_SECRET, SESSION_TTL_SECONDS);
  return c.json({ token, tenant_id: tenantId }, 201);
});

admin.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = body.email?.trim().toLowerCase() ?? '';
  const user = await c.env.DB.prepare(
    'SELECT id, tenant_id, email, password_hash FROM users WHERE email = ?',
  )
    .bind(email)
    .first<{ id: string; tenant_id: string; email: string; password_hash: string }>();

  // ユーザーが居ない場合も同じ応答にして、存在の有無を漏らさない。
  const ok = user ? await verifyPassword(body.password ?? '', user.password_hash) : false;
  if (!user || !ok) return c.json({ error: 'メールアドレスまたはパスワードが違います' }, 401);

  const token = await signToken(
    { userId: user.id, tenantId: user.tenant_id, email: user.email },
    c.env.AUTH_SECRET,
    SESSION_TTL_SECONDS,
  );
  return c.json({ token, tenant_id: user.tenant_id });
});

admin.get('/api/me', async (c) => {
  const { tenantId, email } = c.get('session');
  const tenant = await getTenantById(c.env.DB, tenantId);
  if (!tenant) return c.json({ error: 'tenant not found' }, 404);

  const month = monthKeyJst();
  const usage = await getUsage(c.env.DB, tenantId, month);
  return c.json({
    email,
    tenant: publicTenant(tenant, new URL(c.req.url).origin),
    usage: {
      month,
      used_count: usage.used_count,
      quota: tenant.ai_quota_monthly,
      remaining: Math.max(tenant.ai_quota_monthly - usage.used_count, 0),
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    },
  });
});

admin.put('/api/settings', async (c) => {
  const { tenantId } = c.get('session');
  const body = await c.req.json<{
    name?: string;
    business_hours?: string;
    menu_text?: string;
    faq_text?: string;
    ng_keywords?: string;
    staff_group_id?: string;
    forward_enabled?: boolean;
    ai_enabled?: boolean;
  }>();

  const tenant = await getTenantById(c.env.DB, tenantId);
  if (!tenant) return c.json({ error: 'tenant not found' }, 404);

  const next = {
    name: body.name?.trim() || tenant.name,
    business_hours: body.business_hours ?? tenant.business_hours,
    menu_text: body.menu_text ?? tenant.menu_text,
    faq_text: body.faq_text ?? tenant.faq_text,
    ng_keywords: body.ng_keywords ?? tenant.ng_keywords,
    staff_group_id: body.staff_group_id?.trim() || tenant.staff_group_id,
    forward_enabled: body.forward_enabled === undefined ? tenant.forward_enabled : body.forward_enabled ? 1 : 0,
    ai_enabled: body.ai_enabled === undefined ? tenant.ai_enabled : body.ai_enabled ? 1 : 0,
  };

  await c.env.DB.prepare(
    `UPDATE tenants SET name = ?, business_hours = ?, menu_text = ?, faq_text = ?, ng_keywords = ?,
       staff_group_id = ?, forward_enabled = ?, ai_enabled = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      next.name,
      next.business_hours,
      next.menu_text,
      next.faq_text,
      next.ng_keywords,
      next.staff_group_id,
      next.forward_enabled,
      next.ai_enabled,
      Date.now(),
      tenantId,
    )
    .run();

  const updated = await getTenantById(c.env.DB, tenantId);
  return c.json({ tenant: publicTenant(updated!, new URL(c.req.url).origin) });
});

/** LINE のチャネル情報を登録する。保存時に暗号化し、以後 API では返さない。 */
admin.put('/api/line', async (c) => {
  const { tenantId } = c.get('session');
  const body = await c.req.json<{
    channel_secret?: string;
    access_token?: string;
    bot_user_id?: string;
  }>();

  const channelSecret = body.channel_secret?.trim();
  const accessToken = body.access_token?.trim();
  const botUserId = body.bot_user_id?.trim();
  if (!channelSecret || !accessToken) {
    return c.json({ error: 'チャネルシークレットとアクセストークンの両方が必要です' }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE tenants SET line_channel_secret = ?, line_access_token = ?, line_bot_user_id = ?,
       status = CASE WHEN status = 'trial' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?`,
  )
    .bind(
      await encryptSecret(channelSecret, c.env.ENC_KEY),
      await encryptSecret(accessToken, c.env.ENC_KEY),
      botUserId ?? null,
      Date.now(),
      tenantId,
    )
    .run();

  const updated = await getTenantById(c.env.DB, tenantId);
  return c.json({ tenant: publicTenant(updated!, new URL(c.req.url).origin) });
});

admin.get('/api/customers', async (c) => {
  const { tenantId } = c.get('session');
  const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 100);
  const { results } = await c.env.DB.prepare(
    `SELECT id, display_name, note, last_message_at FROM customers
     WHERE tenant_id = ? ORDER BY last_message_at DESC LIMIT ?`,
  )
    .bind(tenantId, limit)
    .all();
  return c.json({ customers: results ?? [] });
});

admin.get('/api/customers/:id/messages', async (c) => {
  const { tenantId } = c.get('session');
  const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
  const { results } = await c.env.DB.prepare(
    `SELECT id, direction, author, text, created_at FROM messages
     WHERE tenant_id = ? AND customer_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
  )
    .bind(tenantId, c.req.param('id'), limit)
    .all<{ created_at: number }>();
  return c.json({ messages: (results ?? []).reverse() });
});

admin.get('/api/usage', async (c) => {
  const { tenantId } = c.get('session');
  const { results } = await c.env.DB.prepare(
    'SELECT month, used_count, input_tokens, output_tokens FROM ai_usage WHERE tenant_id = ? ORDER BY month DESC LIMIT 12',
  )
    .bind(tenantId)
    .all();
  return c.json({ usage: results ?? [] });
});
