import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  newId,
  signToken,
  timingSafeEqual,
  toBase64,
  verifyPassword,
  verifyToken,
} from '../src/lib/crypto';

const KEY = toBase64(new Uint8Array(32).fill(7));

describe('secret encryption', () => {
  it('復号すると元のトークンに戻る', async () => {
    const secret = 'channel-access-token-abc123';
    const cipher = await encryptSecret(secret, KEY);
    expect(cipher.startsWith('v1.')).toBe(true);
    expect(cipher).not.toContain(secret);
    expect(await decryptSecret(cipher, KEY)).toBe(secret);
  });

  it('毎回ちがう暗号文になる（IV がランダム）', async () => {
    const a = await encryptSecret('same', KEY);
    const b = await encryptSecret('same', KEY);
    expect(a).not.toBe(b);
  });

  it('鍵が違えば復号できない', async () => {
    const cipher = await encryptSecret('secret', KEY);
    const otherKey = toBase64(new Uint8Array(32).fill(9));
    await expect(decryptSecret(cipher, otherKey)).rejects.toThrow();
  });

  it('32バイト以外の鍵は受け付けない', async () => {
    await expect(encryptSecret('x', toBase64(new Uint8Array(16)))).rejects.toThrow(/32-byte/);
  });
});

describe('password hashing', () => {
  it('正しいパスワードだけ通す', async () => {
    const stored = await hashPassword('salon-pass-2026');
    expect(await verifyPassword('salon-pass-2026', stored)).toBe(true);
    expect(await verifyPassword('salon-pass-2025', stored)).toBe(false);
  });

  it('同じパスワードでもハッシュは毎回変わる', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('壊れた保存値では検証を通さない', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('session token', () => {
  const secret = 'auth-secret';

  it('署名した内容を取り出せる', async () => {
    const token = await signToken({ userId: 'usr_1', tenantId: 'ten_1' }, secret, 3600);
    const payload = await verifyToken<{ userId: string; tenantId: string }>(token, secret);
    expect(payload?.userId).toBe('usr_1');
    expect(payload?.tenantId).toBe('ten_1');
  });

  it('改ざんされたトークンを弾く', async () => {
    const token = await signToken({ userId: 'usr_1' }, secret, 3600);
    const [body, signature] = token.split('.');
    const forged = `${btoa(JSON.stringify({ userId: 'usr_evil', exp: 9e9 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')}.${signature}`;
    expect(await verifyToken(forged, secret)).toBeNull();
    expect(await verifyToken(`${body}.${signature}`, 'other-secret')).toBeNull();
  });

  it('期限切れを弾く', async () => {
    const now = Date.now();
    const token = await signToken({ userId: 'usr_1' }, secret, 60, now);
    expect(await verifyToken(token, secret, now + 59_000)).not.toBeNull();
    expect(await verifyToken(token, secret, now + 61_000)).toBeNull();
  });
});

describe('helpers', () => {
  it('timingSafeEqual は長さ違いも false', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
  });

  it('newId は接頭辞つきで衝突しない', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId('ten')));
    expect(ids.size).toBe(100);
    expect([...ids][0]!.startsWith('ten_')).toBe(true);
  });
});

describe('verifyToken の頑健性', () => {
  it('形が壊れたトークンでも例外を投げずに null を返す', async () => {
    for (const bad of ['', 'nodot', 'not.a.token', 'a.b.c', '!!!.???']) {
      await expect(verifyToken(bad, 'auth-secret')).resolves.toBeNull();
    }
  });
});
