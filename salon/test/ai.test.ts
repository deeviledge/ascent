import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, matchNgKeyword } from '../src/lib/ai';
import type { Tenant } from '../src/types';

const tenant: Tenant = {
  id: 'ten_1',
  name: 'サロン ルミエール',
  status: 'active',
  timezone: 'Asia/Tokyo',
  line_channel_secret: null,
  line_access_token: null,
  line_bot_user_id: null,
  staff_group_id: null,
  forward_enabled: 1,
  ai_enabled: 1,
  ai_quota_monthly: 300,
  business_hours: '火〜日 10:00-19:00（月曜定休）',
  menu_text: 'フェイシャル 60分 8,800円',
  faq_text: '駐車場は店舗前に2台あります',
  ng_keywords: '返金\nクレーム',
  created_at: 0,
  updated_at: 0,
};

describe('buildSystemPrompt', () => {
  it('サロン名と設定した情報を全部載せる', () => {
    const prompt = buildSystemPrompt(tenant);
    expect(prompt).toContain('サロン ルミエール');
    expect(prompt).toContain('火〜日 10:00-19:00（月曜定休）');
    expect(prompt).toContain('フェイシャル 60分 8,800円');
    expect(prompt).toContain('駐車場は店舗前に2台あります');
  });

  it('未設定の項目は見出しごと出さない', () => {
    const prompt = buildSystemPrompt({ ...tenant, menu_text: '   ', faq_text: '' });
    expect(prompt).not.toContain('# メニュー・料金');
    expect(prompt).not.toContain('# よくある質問');
    expect(prompt).toContain('# 営業時間');
  });
});

describe('matchNgKeyword', () => {
  it('登録したキーワードを含む問い合わせを拾う', () => {
    expect(matchNgKeyword('先日の施術、返金してほしいです', tenant.ng_keywords)).toBe('返金');
  });

  it('関係ない問い合わせは素通しする', () => {
    expect(matchNgKeyword('明日の空き状況を教えてください', tenant.ng_keywords)).toBeNull();
  });

  it('空行だけの設定で誤爆しない', () => {
    expect(matchNgKeyword('こんにちは', '\n  \n')).toBeNull();
  });
});
