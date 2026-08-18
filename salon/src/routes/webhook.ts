import { Hono } from 'hono';
import { decryptSecret } from '../lib/crypto';
import {
  claimEvent,
  getTenantById,
  consumeAiQuota,
  addAiTokens,
  insertMessage,
  recentMessages,
  refundAiQuota,
  setCustomerName,
  upsertCustomer,
} from '../lib/db';
import { draftReply, matchNgKeyword } from '../lib/ai';
import {
  getProfile,
  pushMessage,
  replyMessage,
  verifyLineSignature,
  type LineEvent,
  type LineWebhookBody,
} from '../lib/line';
import { monthKeyJst, stampJst } from '../lib/time';
import type { AppEnv, Bindings, Tenant } from '../types';

export const webhook = new Hono<AppEnv>();

/**
 * LINE からの Webhook。テナントごとに URL を分ける（1 サロン = 1 LINE 公式アカウント）。
 * LINE 側のタイムアウトを避けるため、検証だけ同期で行い、実処理は waitUntil に逃がす。
 */
webhook.post('/line/webhook/:tenantId', async (c) => {
  const tenantId = c.req.param('tenantId');
  const rawBody = await c.req.text();

  const tenant = await getTenantById(c.env.DB, tenantId);
  if (!tenant) return c.json({ error: 'tenant not found' }, 404);
  if (!tenant.line_channel_secret || !tenant.line_access_token) {
    return c.json({ error: 'tenant is not connected to LINE yet' }, 409);
  }

  const channelSecret = await decryptSecret(tenant.line_channel_secret, c.env.ENC_KEY);
  const ok = await verifyLineSignature(rawBody, c.req.header('x-line-signature') ?? null, channelSecret);
  if (!ok) return c.json({ error: 'invalid signature' }, 401);

  // 解約・停止中は 200 だけ返して何もしない（LINE 側の再送を止めるため）。
  if (tenant.status === 'suspended') return c.json({ ok: true, skipped: 'suspended' });

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  const accessToken = await decryptSecret(tenant.line_access_token, c.env.ENC_KEY);
  const events = body.events ?? [];
  c.executionCtx.waitUntil(
    (async () => {
      for (const event of events) {
        try {
          await handleEvent(c.env, tenant, accessToken, event);
        } catch (error) {
          console.error('webhook event failed', {
            tenantId: tenant.id,
            eventId: event.webhookEventId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })(),
  );

  return c.json({ ok: true, accepted: events.length });
});

async function handleEvent(
  env: Bindings,
  tenant: Tenant,
  accessToken: string,
  event: LineEvent,
): Promise<void> {
  const lineUserId = event.source?.userId;
  // 1:1 トーク以外（スタッフグループ内の発言など）は転送対象にしない。
  if (!lineUserId || event.source?.type !== 'user') return;

  const now = Date.now();
  if (event.webhookEventId) {
    const first = await claimEvent(env.DB, event.webhookEventId, tenant.id, now);
    if (!first) return; // 再送。処理済み。
  }

  if (event.type === 'follow') {
    await handleFollow(env, tenant, accessToken, lineUserId, now);
    return;
  }
  if (event.type !== 'message' || event.message?.type !== 'text') return;

  const incoming = (event.message.text ?? '').trim();
  if (!incoming) return;

  const customer = await upsertCustomer(env.DB, tenant.id, lineUserId, now);
  let displayName = customer.display_name;
  if (customer.isNew || !displayName) {
    const profile = await getProfile(accessToken, lineUserId);
    if (profile?.displayName) {
      displayName = profile.displayName;
      await setCustomerName(env.DB, customer.id, displayName);
    }
  }

  await insertMessage(env.DB, {
    tenantId: tenant.id,
    customerId: customer.id,
    direction: 'in',
    author: 'customer',
    text: incoming,
    lineMessageId: event.message.id,
    now,
  });

  const outcome = await respond(env, tenant, accessToken, {
    customerId: customer.id,
    incoming,
    replyToken: event.replyToken,
    now,
  });

  await notifyStaff(tenant, accessToken, {
    displayName: displayName || 'お客様',
    incoming,
    outcome,
    now,
  });
}

type Outcome =
  | { kind: 'ai'; reply: string }
  | { kind: 'handoff'; reason: string }
  | { kind: 'quota'; reason: string }
  | { kind: 'off' };

async function respond(
  env: Bindings,
  tenant: Tenant,
  accessToken: string,
  args: { customerId: string; incoming: string; replyToken?: string; now: number },
): Promise<Outcome> {
  if (!tenant.ai_enabled) return { kind: 'off' };

  const ng = matchNgKeyword(args.incoming, tenant.ng_keywords);
  if (ng) return { kind: 'handoff', reason: `NGワード「${ng}」` };

  const month = monthKeyJst(args.now);
  const used = await consumeAiQuota(env.DB, tenant.id, month, tenant.ai_quota_monthly, args.now);
  if (used === null) {
    return { kind: 'quota', reason: `今月の AI 応答が上限（${tenant.ai_quota_monthly}件）に達しています` };
  }

  let draft: Awaited<ReturnType<typeof draftReply>>;
  try {
    const history = await recentMessages(env.DB, tenant.id, args.customerId, 10);
    draft = await draftReply({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.AI_MODEL,
      tenant,
      // 直近の受信メッセージは incoming として渡すので履歴からは外す。
      history: history.slice(0, -1),
      incoming: args.incoming,
    });
  } catch (error) {
    // API が落ちているときに枠だけ減らさない。
    await refundAiQuota(env.DB, tenant.id, month, args.now);
    console.error('ai draft failed', error instanceof Error ? error.message : String(error));
    return { kind: 'handoff', reason: 'AI 応答に失敗しました' };
  }

  await addAiTokens(env.DB, tenant.id, month, draft.inputTokens, draft.outputTokens, args.now);

  if (draft.needs_staff || !draft.reply) {
    return { kind: 'handoff', reason: draft.reason || 'スタッフ対応が必要と判断しました' };
  }

  if (args.replyToken) {
    await replyMessage(accessToken, args.replyToken, [draft.reply]);
  }
  await insertMessage(env.DB, {
    tenantId: tenant.id,
    customerId: args.customerId,
    direction: 'out',
    author: 'ai',
    text: draft.reply,
    now: Date.now(),
  });
  return { kind: 'ai', reply: draft.reply };
}

export function buildStaffNotice(args: {
  displayName: string;
  incoming: string;
  outcome: Outcome;
  now: number;
}): string {
  const head = `🗣 ${args.displayName} さん（${stampJst(args.now)}）`;
  const lines = [head, args.incoming, ''];
  switch (args.outcome.kind) {
    case 'ai':
      lines.push('🤖 AI が自動返信しました', args.outcome.reply);
      break;
    case 'handoff':
      lines.push(`⚠️ 要対応：${args.outcome.reason}`, 'お客様にはまだ返信していません。');
      break;
    case 'quota':
      lines.push(`⚠️ 要対応：${args.outcome.reason}`, 'お客様にはまだ返信していません。');
      break;
    case 'off':
      lines.push('（AI 自動応答はオフです）');
      break;
  }
  return lines.join('\n');
}

async function notifyStaff(
  tenant: Tenant,
  accessToken: string,
  args: { displayName: string; incoming: string; outcome: Outcome; now: number },
): Promise<void> {
  if (!tenant.forward_enabled || !tenant.staff_group_id) return;
  await pushMessage(accessToken, tenant.staff_group_id, [buildStaffNotice(args)]);
}

async function handleFollow(
  env: Bindings,
  tenant: Tenant,
  accessToken: string,
  lineUserId: string,
  now: number,
): Promise<void> {
  const customer = await upsertCustomer(env.DB, tenant.id, lineUserId, now);
  const profile = await getProfile(accessToken, lineUserId);
  if (profile?.displayName) await setCustomerName(env.DB, customer.id, profile.displayName);
  if (!tenant.forward_enabled || !tenant.staff_group_id) return;
  await pushMessage(accessToken, tenant.staff_group_id, [
    `✨ ${profile?.displayName ?? 'お客様'} さんが友だち追加しました（${stampJst(now)}）`,
  ]);
}
