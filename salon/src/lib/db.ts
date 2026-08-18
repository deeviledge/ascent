import { newId } from './crypto';
import type { Tenant } from '../types';

export type MessageRow = {
  id: string;
  direction: 'in' | 'out';
  author: 'customer' | 'ai' | 'staff';
  text: string;
  created_at: number;
};

export async function getTenantById(db: D1Database, id: string): Promise<Tenant | null> {
  return db.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first<Tenant>();
}

export async function getTenantByBotUserId(db: D1Database, botUserId: string): Promise<Tenant | null> {
  return db.prepare('SELECT * FROM tenants WHERE line_bot_user_id = ?').bind(botUserId).first<Tenant>();
}

export async function upsertCustomer(
  db: D1Database,
  tenantId: string,
  lineUserId: string,
  now: number,
): Promise<{ id: string; display_name: string; isNew: boolean }> {
  const existing = await db
    .prepare('SELECT id, display_name FROM customers WHERE tenant_id = ? AND line_user_id = ?')
    .bind(tenantId, lineUserId)
    .first<{ id: string; display_name: string }>();

  if (existing) {
    await db
      .prepare('UPDATE customers SET last_message_at = ? WHERE id = ?')
      .bind(now, existing.id)
      .run();
    return { ...existing, isNew: false };
  }

  const id = newId('cus');
  await db
    .prepare(
      'INSERT INTO customers (id, tenant_id, line_user_id, last_message_at, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(id, tenantId, lineUserId, now, now)
    .run();
  return { id, display_name: '', isNew: true };
}

export async function setCustomerName(db: D1Database, customerId: string, name: string): Promise<void> {
  await db.prepare('UPDATE customers SET display_name = ? WHERE id = ?').bind(name, customerId).run();
}

export async function insertMessage(
  db: D1Database,
  row: {
    tenantId: string;
    customerId: string;
    direction: 'in' | 'out';
    author: 'customer' | 'ai' | 'staff';
    text: string;
    lineMessageId?: string | null;
    now: number;
  },
): Promise<string> {
  const id = newId('msg');
  await db
    .prepare(
      `INSERT INTO messages (id, tenant_id, customer_id, direction, author, text, line_message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      row.tenantId,
      row.customerId,
      row.direction,
      row.author,
      row.text,
      row.lineMessageId ?? null,
      row.now,
    )
    .run();
  return id;
}

export async function recentMessages(
  db: D1Database,
  tenantId: string,
  customerId: string,
  limit = 10,
): Promise<MessageRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, direction, author, text, created_at FROM messages
       WHERE tenant_id = ? AND customer_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .bind(tenantId, customerId, limit)
    .all<MessageRow>();
  return (results ?? []).reverse();
}

/**
 * 月間 AI 上限を 1 件ぶん確保する。UPDATE の WHERE で上限を見ているので、
 * 同時に webhook が来ても上限を超えて課金されることはない。
 * 確保できたら消費後の件数、上限に達していたら null を返す。
 */
export async function consumeAiQuota(
  db: D1Database,
  tenantId: string,
  month: string,
  quota: number,
  now: number,
): Promise<number | null> {
  if (quota <= 0) return null;
  const row = await db
    .prepare(
      `INSERT INTO ai_usage (tenant_id, month, used_count, updated_at) VALUES (?, ?, 1, ?)
       ON CONFLICT (tenant_id, month) DO UPDATE SET used_count = used_count + 1, updated_at = excluded.updated_at
       WHERE ai_usage.used_count < ?
       RETURNING used_count`,
    )
    .bind(tenantId, month, now, quota)
    .first<{ used_count: number }>();
  return row ? row.used_count : null;
}

/** 確保したぶんを返す（AI 呼び出しに失敗したときの巻き戻し）。 */
export async function refundAiQuota(
  db: D1Database,
  tenantId: string,
  month: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE ai_usage SET used_count = MAX(used_count - 1, 0), updated_at = ?
       WHERE tenant_id = ? AND month = ?`,
    )
    .bind(now, tenantId, month)
    .run();
}

export async function addAiTokens(
  db: D1Database,
  tenantId: string,
  month: string,
  inputTokens: number,
  outputTokens: number,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE ai_usage SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, updated_at = ?
       WHERE tenant_id = ? AND month = ?`,
    )
    .bind(inputTokens, outputTokens, now, tenantId, month)
    .run();
}

export async function getUsage(
  db: D1Database,
  tenantId: string,
  month: string,
): Promise<{ used_count: number; input_tokens: number; output_tokens: number }> {
  const row = await db
    .prepare('SELECT used_count, input_tokens, output_tokens FROM ai_usage WHERE tenant_id = ? AND month = ?')
    .bind(tenantId, month)
    .first<{ used_count: number; input_tokens: number; output_tokens: number }>();
  return row ?? { used_count: 0, input_tokens: 0, output_tokens: 0 };
}

/**
 * LINE は同じ webhook を再送することがある。初回だけ true を返す。
 */
export async function claimEvent(
  db: D1Database,
  eventId: string,
  tenantId: string,
  now: number,
): Promise<boolean> {
  const res = await db
    .prepare('INSERT OR IGNORE INTO processed_events (event_id, tenant_id, created_at) VALUES (?, ?, ?)')
    .bind(eventId, tenantId, now)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}
