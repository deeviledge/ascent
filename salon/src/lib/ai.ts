import Anthropic from '@anthropic-ai/sdk';
import type { MessageRow } from './db';
import type { Tenant } from '../types';

export type AiDraft = {
  reply: string;
  needs_staff: boolean;
  reason: string;
};

export type AiResult = AiDraft & {
  inputTokens: number;
  outputTokens: number;
};

const DRAFT_TOOL: Anthropic.Tool = {
  name: 'draft_reply',
  description: 'サロンのお客様への返信文と、スタッフに引き継ぐべきかどうかを返す。',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      reply: {
        type: 'string',
        description: 'お客様にそのまま送る日本語の返信文。丁寧語で 200 文字以内。',
      },
      needs_staff: {
        type: 'boolean',
        description: '予約の確定・変更、金額の交渉、クレーム、体調や施術リスクの相談なら true。',
      },
      reason: {
        type: 'string',
        description: 'needs_staff の判断理由を 30 文字以内で。スタッフ通知にだけ使う。',
      },
    },
    required: ['reply', 'needs_staff', 'reason'],
    additionalProperties: false,
  },
};

export function buildSystemPrompt(tenant: Tenant): string {
  const sections = [
    `あなたは「${tenant.name}」の LINE 窓口を担当するアシスタントです。`,
    'お客様からの一次応答を、サロンのスタッフに代わって行います。',
    '',
    '# 守ること',
    '- 日本語の丁寧語。1〜3 文、200 文字以内。絵文字は使わない。',
    '- 予約の確定・変更・キャンセルの確約はしない。「担当より折り返します」と伝えて needs_staff を true にする。',
    '- 料金・施術内容は、下の情報に書かれている範囲だけを答える。書かれていないことは推測で答えない。',
    '- 体調・アレルギー・施術のリスクに関わる相談は必ず needs_staff を true にする。',
    '- 個人情報（電話番号・住所・カード情報）を LINE で送るよう促さない。',
  ];

  if (tenant.business_hours.trim()) {
    sections.push('', '# 営業時間', tenant.business_hours.trim());
  }
  if (tenant.menu_text.trim()) {
    sections.push('', '# メニュー・料金', tenant.menu_text.trim());
  }
  if (tenant.faq_text.trim()) {
    sections.push('', '# よくある質問', tenant.faq_text.trim());
  }

  return sections.join('\n');
}

/** NG ワードを含む問い合わせは AI を通さず、そのままスタッフへ回す。 */
export function matchNgKeyword(text: string, ngKeywords: string): string | null {
  for (const raw of ngKeywords.split(/\r?\n/)) {
    const keyword = raw.trim();
    if (keyword && text.includes(keyword)) return keyword;
  }
  return null;
}

function toApiMessages(history: MessageRow[], incoming: string): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];
  for (const row of history) {
    const role = row.direction === 'in' ? 'user' : 'assistant';
    // 同じ役割が連続すると API に弾かれるのでまとめる。
    const last = messages[messages.length - 1];
    if (last && last.role === role && typeof last.content === 'string') {
      last.content = `${last.content}\n${row.text}`;
    } else {
      messages.push({ role, content: row.text });
    }
  }
  const last = messages[messages.length - 1];
  if (last && last.role === 'user' && typeof last.content === 'string') {
    last.content = `${last.content}\n${incoming}`;
  } else {
    messages.push({ role: 'user', content: incoming });
  }
  return messages;
}

/**
 * 一次応答の下書きを作る。
 * 原価が売上を圧迫しないよう、既定は軽量モデル（claude-haiku-4-5）＋短い max_tokens。
 * 拡張思考は使わない（このタスクには過剰で、そのぶん出力トークン＝原価が増えるだけ）。
 */
export async function draftReply(args: {
  apiKey: string;
  model: string;
  tenant: Tenant;
  history: MessageRow[];
  incoming: string;
}): Promise<AiResult> {
  const client = new Anthropic({ apiKey: args.apiKey });

  const response = await client.messages.create({
    model: args.model,
    max_tokens: 1024,
    system: buildSystemPrompt(args.tenant),
    messages: toApiMessages(args.history, args.incoming),
    tools: [DRAFT_TOOL],
    tool_choice: { type: 'tool', name: 'draft_reply' },
  });

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };

  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'draft_reply') {
      // tool_use.input はエスケープが揺れることがあるので、必ずオブジェクトとして扱う。
      const input = block.input as Partial<AiDraft>;
      const reply = typeof input.reply === 'string' ? input.reply.trim() : '';
      // 返信文が空でも「スタッフに回す」という判断そのものは結果として活かす。
      if (reply || input.needs_staff === true) {
        return {
          reply,
          needs_staff: input.needs_staff === true || !reply,
          reason: typeof input.reason === 'string' ? input.reason : '',
          ...usage,
        };
      }
    }
  }

  // 返信文が取れなかったときは黙って諦めず、スタッフに回す。
  return {
    reply: '',
    needs_staff: true,
    reason: 'AI が返信を生成できませんでした',
    ...usage,
  };
}
