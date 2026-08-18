// WebCrypto だけで完結させる（Workers / Node どちらでも同じコードが動く）。
// 依存を足さないぶんバンドルが小さく、CPU 実行時間＝コストも抑えられる。

const enc = new TextEncoder();
const dec = new TextDecoder();

const PBKDF2_ITERATIONS = 210_000;

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

/** 長さの違いも含めて一定時間で比較する。 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function importAesKey(keyBase64: string): Promise<CryptoKey> {
  const raw = fromBase64(keyBase64);
  if (raw.length !== 32) {
    throw new Error('ENC_KEY must be a base64-encoded 32-byte key');
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * テナントの LINE トークンなど、漏れると直接被害が出る値を保存前に暗号化する。
 * 形式: v1.<iv(base64)>.<ciphertext(base64)>
 */
export async function encryptSecret(plaintext: string, keyBase64: string): Promise<string> {
  const key = await importAesKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(payload: string, keyBase64: string): Promise<string> {
  const [version, ivPart, cipherPart] = payload.split('.');
  if (version !== 'v1' || !ivPart || !cipherPart) {
    throw new Error('unsupported ciphertext format');
  }
  const key = await importAesKey(keyBase64);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivPart) },
    key,
    fromBase64(cipherPart),
  );
  return dec.decode(plain);
}

export async function hashPassword(password: string, salt?: Uint8Array): Promise<string> {
  const useSalt = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: useSalt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(useSalt)}$${toBase64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, saltPart, hashPart] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iterations || !saltPart || !hashPart) return false;
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromBase64(saltPart), iterations: Number(iterations), hash: 'SHA-256' },
    material,
    256,
  );
  return timingSafeEqual(new Uint8Array(bits), fromBase64(hashPart));
}

async function importHmacKey(secret: string, usages: ("sign" | "verify")[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

export async function hmacSha256(secret: string, message: string | Uint8Array): Promise<Uint8Array> {
  const key = await importHmacKey(secret, ['sign']);
  const data = typeof message === 'string' ? enc.encode(message) : message;
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

/**
 * 管理画面のセッショントークン。D1 に往復させないぶん読み取りコストがゼロで済む。
 * 形式: <payload(base64url)>.<hmac(base64url)>
 */
export async function signToken(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds: number,
  now = Date.now(),
): Promise<string> {
  const body = { ...payload, exp: Math.floor(now / 1000) + ttlSeconds };
  const encoded = toBase64Url(enc.encode(JSON.stringify(body)));
  const signature = await hmacSha256(secret, encoded);
  return `${encoded}.${toBase64Url(signature)}`;
}

export async function verifyToken<T = Record<string, unknown>>(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<T | null> {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  try {
    // 壊れた base64 や JSON が投げてくる例外も「無効なトークン」として扱う。
    const expected = await hmacSha256(secret, encoded);
    if (!timingSafeEqual(expected, fromBase64Url(signature))) return null;
    const payload = JSON.parse(dec.decode(fromBase64Url(encoded))) as { exp?: number };
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) return null;
    return payload as T;
  } catch {
    return null;
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}
