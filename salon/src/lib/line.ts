import { fromBase64, hmacSha256, timingSafeEqual } from './crypto';

const LINE_API = 'https://api.line.me/v2/bot';

export type LineSource =
  | { type: 'user'; userId?: string }
  | { type: 'group'; groupId: string; userId?: string }
  | { type: 'room'; roomId: string; userId?: string };

export type LineEvent = {
  type: string;
  webhookEventId?: string;
  timestamp?: number;
  replyToken?: string;
  source?: LineSource;
  message?: { id: string; type: string; text?: string };
};

export type LineWebhookBody = {
  destination?: string;
  events?: LineEvent[];
};

/**
 * X-Line-Signature の検証。生のリクエストボディに対して行う必要があるので、
 * JSON へパースする前の文字列（またはバイト列）を渡すこと。
 */
export async function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
): Promise<boolean> {
  if (!signature) return false;
  let provided: Uint8Array;
  try {
    provided = fromBase64(signature);
  } catch {
    return false;
  }
  const expected = await hmacSha256(channelSecret, rawBody);
  return timingSafeEqual(expected, provided);
}

export class LineApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`LINE API error ${status}: ${body}`);
    this.name = 'LineApiError';
  }
}

async function callLine(path: string, accessToken: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`${LINE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new LineApiError(res.status, await res.text());
  }
  return res;
}

function textMessages(texts: string[]) {
  // LINE のテキストは 5,000 文字上限。1 回のリクエストで送れるのは 5 通まで。
  return texts.slice(0, 5).map((text) => ({ type: 'text', text: text.slice(0, 5000) }));
}

/** 返信は無料メッセージ枠。応答は基本こちらを使う。 */
export async function replyMessage(
  accessToken: string,
  replyToken: string,
  texts: string[],
): Promise<void> {
  await callLine('/message/reply', accessToken, {
    method: 'POST',
    body: JSON.stringify({ replyToken, messages: textMessages(texts) }),
  });
}

/** スタッフグループへの転送はプッシュ（無料枠 200通/月 を消費する）。 */
export async function pushMessage(accessToken: string, to: string, texts: string[]): Promise<void> {
  await callLine('/message/push', accessToken, {
    method: 'POST',
    body: JSON.stringify({ to, messages: textMessages(texts) }),
  });
}

export async function getProfile(
  accessToken: string,
  userId: string,
): Promise<{ displayName: string } | null> {
  try {
    const res = await callLine(`/profile/${encodeURIComponent(userId)}`, accessToken, { method: 'GET' });
    return (await res.json()) as { displayName: string };
  } catch {
    // 友だち未追加などで 404 になる。名前が取れなくても本筋は続行させる。
    return null;
  }
}

export function sourceUserId(source: LineSource | undefined): string | null {
  return source?.userId ?? null;
}
