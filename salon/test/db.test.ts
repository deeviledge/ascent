import { beforeEach, describe, expect, it } from 'vitest';
import {
  addAiTokens,
  claimEvent,
  consumeAiQuota,
  getUsage,
  insertMessage,
  recentMessages,
  refundAiQuota,
  upsertCustomer,
} from '../src/lib/db';
import { createTestDb, seedTenant, type FakeD1 } from './helpers/d1';

const MONTH = '2026-08';
const NOW = Date.parse('2026-08-18T05:00:00Z');

let db: FakeD1;
// 実際の D1Database ではなく SQL 互換シムを渡す。
const as = (value: FakeD1) => value as unknown as D1Database;

beforeEach(async () => {
  db = createTestDb();
  await seedTenant(db, 'ten_1', 3);
});

describe('consumeAiQuota', () => {
  it('上限までは通し、超えた瞬間に止める', async () => {
    expect(await consumeAiQuota(as(db), 'ten_1', MONTH, 3, NOW)).toBe(1);
    expect(await consumeAiQuota(as(db), 'ten_1', MONTH, 3, NOW)).toBe(2);
    expect(await consumeAiQuota(as(db), 'ten_1', MONTH, 3, NOW)).toBe(3);
    expect(await consumeAiQuota(as(db), 'ten_1', MONTH, 3, NOW)).toBeNull();
    expect((await getUsage(as(db), 'ten_1', MONTH)).used_count).toBe(3);
  });

  it('月が変われば枠は戻る', async () => {
    for (let i = 0; i < 3; i++) await consumeAiQuota(as(db), 'ten_1', MONTH, 3, NOW);
    expect(await consumeAiQuota(as(db), 'ten_1', MONTH, 3, NOW)).toBeNull();
    expect(await consumeAiQuota(as(db), 'ten_1', '2026-09', 3, NOW)).toBe(1);
  });

  it('上限0なら1件も通さない', async () => {
    expect(await consumeAiQuota(as(db), 'ten_1', MONTH, 0, NOW)).toBeNull();
    expect((await getUsage(as(db), 'ten_1', MONTH)).used_count).toBe(0);
  });

  it('失敗時の返却で枠が戻る（マイナスにはならない）', async () => {
    await consumeAiQuota(as(db), 'ten_1', MONTH, 3, NOW);
    await refundAiQuota(as(db), 'ten_1', MONTH, NOW);
    expect((await getUsage(as(db), 'ten_1', MONTH)).used_count).toBe(0);
    await refundAiQuota(as(db), 'ten_1', MONTH, NOW);
    expect((await getUsage(as(db), 'ten_1', MONTH)).used_count).toBe(0);
  });

  it('トークン数を積み上げられる', async () => {
    await consumeAiQuota(as(db), 'ten_1', MONTH, 3, NOW);
    await addAiTokens(as(db), 'ten_1', MONTH, 120, 45, NOW);
    await consumeAiQuota(as(db), 'ten_1', MONTH, 3, NOW);
    await addAiTokens(as(db), 'ten_1', MONTH, 80, 30, NOW);
    const usage = await getUsage(as(db), 'ten_1', MONTH);
    expect(usage).toMatchObject({ used_count: 2, input_tokens: 200, output_tokens: 75 });
  });

  it('未使用の月は0件で返る', async () => {
    expect(await getUsage(as(db), 'ten_1', '2025-01')).toMatchObject({ used_count: 0 });
  });
});

describe('claimEvent', () => {
  it('同じ webhook イベントは1回しか処理しない', async () => {
    expect(await claimEvent(as(db), 'evt_1', 'ten_1', NOW)).toBe(true);
    expect(await claimEvent(as(db), 'evt_1', 'ten_1', NOW)).toBe(false);
    expect(await claimEvent(as(db), 'evt_2', 'ten_1', NOW)).toBe(true);
  });
});

describe('customers and messages', () => {
  it('同じ LINE ユーザーは1件に寄せ、最終受信時刻を更新する', async () => {
    const first = await upsertCustomer(as(db), 'ten_1', 'U_line_1', NOW);
    expect(first.isNew).toBe(true);
    const second = await upsertCustomer(as(db), 'ten_1', 'U_line_1', NOW + 1000);
    expect(second.isNew).toBe(false);
    expect(second.id).toBe(first.id);

    const row = await db
      .prepare('SELECT last_message_at FROM customers WHERE id = ?')
      .bind(first.id)
      .first<{ last_message_at: number }>();
    expect(row?.last_message_at).toBe(NOW + 1000);
  });

  it('会話履歴は古い順で返る', async () => {
    const customer = await upsertCustomer(as(db), 'ten_1', 'U_line_1', NOW);
    await insertMessage(as(db), {
      tenantId: 'ten_1',
      customerId: customer.id,
      direction: 'in',
      author: 'customer',
      text: '明日空いてますか？',
      now: NOW,
    });
    await insertMessage(as(db), {
      tenantId: 'ten_1',
      customerId: customer.id,
      direction: 'out',
      author: 'ai',
      text: '担当より折り返します。',
      now: NOW + 1000,
    });

    const history = await recentMessages(as(db), 'ten_1', customer.id, 10);
    expect(history.map((m) => m.text)).toEqual(['明日空いてますか？', '担当より折り返します。']);
    expect(history[0]!.author).toBe('customer');
  });

  it('取得件数を絞ると新しいものが残る', async () => {
    const customer = await upsertCustomer(as(db), 'ten_1', 'U_line_1', NOW);
    for (let i = 0; i < 5; i++) {
      await insertMessage(as(db), {
        tenantId: 'ten_1',
        customerId: customer.id,
        direction: 'in',
        author: 'customer',
        text: `メッセージ${i}`,
        now: NOW + i * 1000,
      });
    }
    const history = await recentMessages(as(db), 'ten_1', customer.id, 2);
    expect(history.map((m) => m.text)).toEqual(['メッセージ3', 'メッセージ4']);
  });
});
