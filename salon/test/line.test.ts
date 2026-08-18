import { describe, expect, it } from 'vitest';
import { hmacSha256, toBase64 } from '../src/lib/crypto';
import { verifyLineSignature } from '../src/lib/line';

const SECRET = 'line-channel-secret';
const BODY = JSON.stringify({ destination: 'U123', events: [{ type: 'message' }] });

async function sign(body: string, secret = SECRET): Promise<string> {
  return toBase64(await hmacSha256(secret, body));
}

describe('verifyLineSignature', () => {
  it('正しい署名を通す', async () => {
    expect(await verifyLineSignature(BODY, await sign(BODY), SECRET)).toBe(true);
  });

  it('ボディが1文字でも違えば落とす', async () => {
    const signature = await sign(BODY);
    expect(await verifyLineSignature(`${BODY} `, signature, SECRET)).toBe(false);
  });

  it('別のチャネルシークレットの署名を落とす', async () => {
    expect(await verifyLineSignature(BODY, await sign(BODY, 'other'), SECRET)).toBe(false);
  });

  it('署名ヘッダが無い / 壊れている場合は落とす', async () => {
    expect(await verifyLineSignature(BODY, null, SECRET)).toBe(false);
    expect(await verifyLineSignature(BODY, '!!!not-base64!!!', SECRET)).toBe(false);
  });
});
