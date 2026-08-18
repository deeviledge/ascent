import { beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, toBase64 } from '../src/lib/crypto';
import { admin } from '../src/routes/admin';
import { createTestDb, type FakeD1 } from './helpers/d1';

const ENC_KEY = toBase64(new Uint8Array(32).fill(5));
let db: FakeD1;

function env() {
  return {
    DB: db as unknown as D1Database,
    AI_MODEL: 'claude-haiku-4-5',
    DEFAULT_AI_QUOTA: '300',
    ALLOWED_ORIGINS: '',
    ANTHROPIC_API_KEY: 'sk-test',
    ENC_KEY,
    AUTH_SECRET: 'auth-secret',
  };
}

function call(path: string, init: RequestInit = {}, token?: string) {
  return admin.request(
    `http://api.test${path}`,
    {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    },
    env(),
  );
}

// json() は unknown を返すので、テスト側で形を宣言して受ける。
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

type TenantView = {
  id: string;
  name: string;
  status: string;
  business_hours: string;
  menu_text: string;
  ng_keywords: string;
  staff_group_id: string | null;
  ai_enabled: boolean;
  forward_enabled: boolean;
  line_connected: boolean;
  webhook_url: string;
};

async function signup(email = 'owner@salon.test', password = 'salon-pass-2026') {
  const res = await call('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ salon_name: 'サロン ルミエール', email, password }),
  });
  expect(res.status).toBe(201);
  return json<{ token: string; tenant_id: string }>(res);
}

beforeEach(() => {
  db = createTestDb();
});

describe('signup / login', () => {
  it('サインアップでテナントとオーナーが作られる', async () => {
    const { token, tenant_id } = await signup();
    expect(token).toBeTruthy();

    const me = await json<{ tenant: TenantView; usage: Record<string, number> }>(
      await call('/api/me', {}, token),
    );
    expect(me.tenant.id).toBe(tenant_id);
    expect(me.tenant.name).toBe('サロン ルミエール');
    expect(me.tenant.status).toBe('trial');
    expect(me.usage).toMatchObject({ used_count: 0, quota: 300, remaining: 300 });
  });

  it('同じメールアドレスでは二重に登録できない', async () => {
    await signup();
    const res = await call('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ salon_name: '別サロン', email: 'owner@salon.test', password: 'another-pass' }),
    });
    expect(res.status).toBe(409);
  });

  it('短いパスワードを弾く', async () => {
    const res = await call('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ salon_name: 'サロン', email: 'a@b.test', password: 'short' }),
    });
    expect(res.status).toBe(400);
  });

  it('正しいパスワードでだけログインできる', async () => {
    await signup();
    const ok = await call('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@salon.test', password: 'salon-pass-2026' }),
    });
    expect(ok.status).toBe(200);

    const wrongPassword = await call('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@salon.test', password: 'wrong-password' }),
    });
    const unknownEmail = await call('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody@salon.test', password: 'salon-pass-2026' }),
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // どちらも同じ応答にして、そのメールアドレスが登録済みかどうかを漏らさない。
    expect(await json<unknown>(unknownEmail)).toEqual(await json<unknown>(wrongPassword));
  });
});

describe('認証', () => {
  it('トークン無しでは設定を読めない', async () => {
    expect((await call('/api/me')).status).toBe(401);
    expect((await call('/api/customers')).status).toBe(401);
    expect((await call('/api/settings', { method: 'PUT', body: '{}' })).status).toBe(401);
  });

  it('偽のトークンを弾く', async () => {
    expect((await call('/api/me', {}, 'not.a.token')).status).toBe(401);
  });

  it('他テナントのお客様は見えない', async () => {
    const a = await signup('a@salon.test');
    const b = await signup('b@salon.test');
    await db
      .prepare('INSERT INTO customers (id, tenant_id, line_user_id, created_at) VALUES (?, ?, ?, 0)')
      .bind('cus_a', a.tenant_id, 'U_a')
      .run();

    type CustomerList = { customers: { id: string }[] };
    const seenByA = await json<CustomerList>(await call('/api/customers', {}, a.token));
    const seenByB = await json<CustomerList>(await call('/api/customers', {}, b.token));
    expect(seenByA.customers).toHaveLength(1);
    expect(seenByB.customers).toHaveLength(0);
  });
});

describe('設定', () => {
  it('応答設定を保存できる', async () => {
    const { token } = await signup();
    const res = await call(
      '/api/settings',
      {
        method: 'PUT',
        body: JSON.stringify({
          business_hours: '火〜日 10:00-19:00',
          menu_text: 'フェイシャル 60分 8,800円',
          ng_keywords: '返金',
          staff_group_id: 'C_staff',
          ai_enabled: false,
        }),
      },
      token,
    );
    const { tenant } = await json<{ tenant: TenantView }>(res);
    expect(tenant).toMatchObject({
      business_hours: '火〜日 10:00-19:00',
      menu_text: 'フェイシャル 60分 8,800円',
      ng_keywords: '返金',
      staff_group_id: 'C_staff',
      ai_enabled: false,
      forward_enabled: true,
    });
  });

  it('LINE の値は暗号化して保存し、API では返さない', async () => {
    const { token, tenant_id } = await signup();
    const res = await call(
      '/api/line',
      {
        method: 'PUT',
        body: JSON.stringify({ channel_secret: 'secret-abc', access_token: 'token-xyz' }),
      },
      token,
    );
    const { tenant } = await json<{ tenant: TenantView }>(res);

    expect(tenant.line_connected).toBe(true);
    expect(tenant.status).toBe('active'); // trial から昇格する
    expect(tenant.webhook_url).toBe(`http://api.test/line/webhook/${tenant_id}`);
    expect(JSON.stringify(tenant)).not.toContain('secret-abc');
    expect(JSON.stringify(tenant)).not.toContain('token-xyz');

    const row = await db
      .prepare('SELECT line_channel_secret, line_access_token FROM tenants WHERE id = ?')
      .bind(tenant_id)
      .first<{ line_channel_secret: string; line_access_token: string }>();
    expect(row!.line_channel_secret).not.toContain('secret-abc');
    expect(await decryptSecret(row!.line_channel_secret, ENC_KEY)).toBe('secret-abc');
    expect(await decryptSecret(row!.line_access_token, ENC_KEY)).toBe('token-xyz');
  });

  it('チャネルシークレットだけでは保存しない', async () => {
    const { token } = await signup();
    const res = await call('/api/line', { method: 'PUT', body: JSON.stringify({ channel_secret: 'x' }) }, token);
    expect(res.status).toBe(400);
  });
});
