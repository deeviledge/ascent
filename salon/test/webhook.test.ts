import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret, hmacSha256, toBase64 } from '../src/lib/crypto';
import { webhook } from '../src/routes/webhook';
import { createTestDb, type FakeD1 } from './helpers/d1';

const CHANNEL_SECRET = 'line-channel-secret';
const ACCESS_TOKEN = 'line-access-token';
const ENC_KEY = toBase64(new Uint8Array(32).fill(3));

let db: FakeD1;
let calls: { url: string; body: unknown }[];
let pending: Promise<unknown>[];

function env() {
  return {
    DB: db as unknown as D1Database,
    AI_MODEL: 'claude-haiku-4-5',
    DEFAULT_AI_QUOTA: '300',
    ALLOWED_ORIGINS: '',
    ANTHROPIC_API_KEY: 'sk-test',
    ENC_KEY,
    AUTH_SECRET: 'auth',
  };
}

const ctx = {
  waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function aiResponse(input: { reply: string; needs_staff: boolean; reason: string }) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    content: [{ type: 'tool_use', id: 'toolu_1', name: 'draft_reply', input }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 120, output_tokens: 40 },
  };
}

let aiInput = { reply: '明日は14時と17時が空いております。', needs_staff: false, reason: '' };

beforeEach(async () => {
  db = createTestDb();
  calls = [];
  pending = [];
  aiInput = { reply: '明日は14時と17時が空いております。', needs_staff: false, reason: '' };

  await db
    .prepare(
      `INSERT INTO tenants (id, name, status, line_channel_secret, line_access_token, staff_group_id,
         forward_enabled, ai_enabled, ai_quota_monthly, created_at, updated_at)
       VALUES (?, ?, 'active', ?, ?, 'C_staff', 1, 1, 3, 0, 0)`,
    )
    .bind(
      'ten_1',
      'テストサロン',
      await encryptSecret(CHANNEL_SECRET, ENC_KEY),
      await encryptSecret(ACCESS_TOKEN, ENC_KEY),
    )
    .run();

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });

    if (url.includes('api.anthropic.com')) {
      return new Response(JSON.stringify(aiResponse(aiInput)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/v2/bot/profile/')) {
      return new Response(JSON.stringify({ displayName: '山田 花子' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
});

afterEach(() => vi.unstubAllGlobals());

async function post(body: unknown, options: { signature?: string; tenantId?: string } = {}) {
  const raw = JSON.stringify(body);
  const signature = options.signature ?? toBase64(await hmacSha256(CHANNEL_SECRET, raw));
  const res = await webhook.request(
    `/line/webhook/${options.tenantId ?? 'ten_1'}`,
    { method: 'POST', headers: { 'x-line-signature': signature, 'content-type': 'application/json' }, body: raw },
    env(),
    ctx,
  );
  await Promise.all(pending);
  return res;
}

function textEvent(overrides: Record<string, unknown> = {}) {
  return {
    destination: 'U_bot',
    events: [
      {
        type: 'message',
        webhookEventId: 'evt_1',
        replyToken: 'reply_token_1',
        source: { type: 'user', userId: 'U_customer_1' },
        message: { id: 'm_1', type: 'text', text: '明日空いてますか？' },
        ...overrides,
      },
    ],
  };
}

const lineCalls = (path: string) => calls.filter((call) => call.url.includes(path));

describe('LINE webhook', () => {
  it('署名が不正なら 401 で何も処理しない', async () => {
    const res = await post(textEvent(), { signature: toBase64(await hmacSha256('wrong', 'x')) });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('存在しないテナントは 404', async () => {
    const res = await post(textEvent(), { tenantId: 'ten_unknown' });
    expect(res.status).toBe(404);
  });

  it('お客様に自動返信し、スタッフグループへ転送し、履歴を残す', async () => {
    const res = await post(textEvent());
    expect(res.status).toBe(200);

    expect(lineCalls('/message/reply')[0]?.body).toMatchObject({
      replyToken: 'reply_token_1',
      messages: [{ type: 'text', text: '明日は14時と17時が空いております。' }],
    });

    const push = lineCalls('/message/push')[0]?.body as { to: string; messages: { text: string }[] };
    expect(push.to).toBe('C_staff');
    expect(push.messages[0]!.text).toContain('山田 花子');
    expect(push.messages[0]!.text).toContain('🤖 AI が自動返信しました');

    const { results } = await db
      .prepare('SELECT direction, author, text FROM messages WHERE tenant_id = ? ORDER BY created_at')
      .bind('ten_1')
      .all<{ direction: string; author: string; text: string }>();
    expect(results.map((row) => [row.direction, row.author])).toEqual([
      ['in', 'customer'],
      ['out', 'ai'],
    ]);

    const usage = await db
      .prepare('SELECT used_count, input_tokens FROM ai_usage WHERE tenant_id = ?')
      .bind('ten_1')
      .first<{ used_count: number; input_tokens: number }>();
    expect(usage).toMatchObject({ used_count: 1, input_tokens: 120 });
  });

  it('同じイベントが再送されても二重に返信しない', async () => {
    await post(textEvent());
    await post(textEvent());
    expect(lineCalls('/message/reply')).toHaveLength(1);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM messages').first<{ n: number }>())?.n).toBe(2);
  });

  it('AI が要対応と判断したら返信せずスタッフに回す', async () => {
    aiInput = { reply: '', needs_staff: true, reason: '予約の確定依頼' };
    await post(textEvent());
    expect(lineCalls('/message/reply')).toHaveLength(0);
    const push = lineCalls('/message/push')[0]?.body as { messages: { text: string }[] };
    expect(push.messages[0]!.text).toContain('⚠️ 要対応：予約の確定依頼');
  });

  it('NG ワードを含む問い合わせは AI を呼ばずスタッフに回す', async () => {
    await db.prepare('UPDATE tenants SET ng_keywords = ? WHERE id = ?').bind('返金', 'ten_1').run();
    await post(textEvent({ message: { id: 'm_2', type: 'text', text: '返金してください' } }));
    expect(lineCalls('api.anthropic.com')).toHaveLength(0);
    const push = lineCalls('/message/push')[0]?.body as { messages: { text: string }[] };
    expect(push.messages[0]!.text).toContain('NGワード「返金」');
  });

  it('上限に達したら AI を呼ばず、スタッフに上限到達を知らせる', async () => {
    await db
      .prepare('INSERT INTO ai_usage (tenant_id, month, used_count, updated_at) VALUES (?, ?, 3, 0)')
      .bind('ten_1', new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7))
      .run();

    await post(textEvent());
    expect(lineCalls('api.anthropic.com')).toHaveLength(0);
    const push = lineCalls('/message/push')[0]?.body as { messages: { text: string }[] };
    expect(push.messages[0]!.text).toContain('上限');
  });

  it('AI が失敗したら枠を戻し、スタッフに回す', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.includes('api.anthropic.com')) {
        return new Response(JSON.stringify({ error: { message: 'overloaded' } }), {
          status: 529,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });

    await post(textEvent());
    const usage = await db
      .prepare('SELECT used_count FROM ai_usage WHERE tenant_id = ?')
      .bind('ten_1')
      .first<{ used_count: number }>();
    expect(usage?.used_count).toBe(0);
    expect(lineCalls('/message/reply')).toHaveLength(0);
    expect(lineCalls('/message/push')).toHaveLength(1);
  });

  it('スタッフグループ内の発言は転送対象にしない', async () => {
    await post(textEvent({ source: { type: 'group', groupId: 'C_staff', userId: 'U_staff' } }));
    expect(calls).toHaveLength(0);
  });

  it('LINE 未接続のテナントは 409 を返す', async () => {
    await db
      .prepare('UPDATE tenants SET line_channel_secret = NULL, line_access_token = NULL WHERE id = ?')
      .bind('ten_1')
      .run();
    const res = await post(textEvent());
    expect(res.status).toBe(409);
  });
});
