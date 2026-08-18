export type Bindings = {
  DB: D1Database;

  // vars
  AI_MODEL: string;
  DEFAULT_AI_QUOTA: string;
  ALLOWED_ORIGINS: string;

  // secrets
  ANTHROPIC_API_KEY: string;
  ENC_KEY: string;
  AUTH_SECRET: string;
};

export type Session = {
  userId: string;
  tenantId: string;
  email: string;
};

export type Variables = {
  session: Session;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };

export type Tenant = {
  id: string;
  name: string;
  status: 'trial' | 'active' | 'suspended';
  timezone: string;
  line_channel_secret: string | null;
  line_access_token: string | null;
  line_bot_user_id: string | null;
  staff_group_id: string | null;
  forward_enabled: number;
  ai_enabled: number;
  ai_quota_monthly: number;
  business_hours: string;
  menu_text: string;
  faq_text: string;
  ng_keywords: string;
  created_at: number;
  updated_at: number;
};
