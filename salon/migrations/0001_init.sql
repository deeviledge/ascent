-- 個人サロン向け LINE コンシェルジュ / 初期スキーマ
-- D1 (SQLite) 前提。テナント数千規模までは単一 DB で十分に捌ける。

CREATE TABLE tenants (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'trial',   -- trial | active | suspended
  timezone              TEXT NOT NULL DEFAULT 'Asia/Tokyo',

  -- LINE 連携（暗号文。AES-GCM / ENC_KEY で暗号化して保存する）
  line_channel_secret   TEXT,
  line_access_token     TEXT,
  line_bot_user_id      TEXT,                            -- webhook の destination と突き合わせる
  staff_group_id        TEXT,                            -- 転送先グループ / ルーム ID

  -- 挙動設定
  forward_enabled       INTEGER NOT NULL DEFAULT 1,
  ai_enabled            INTEGER NOT NULL DEFAULT 1,
  ai_quota_monthly      INTEGER NOT NULL DEFAULT 300,
  business_hours        TEXT NOT NULL DEFAULT '',
  menu_text             TEXT NOT NULL DEFAULT '',
  faq_text              TEXT NOT NULL DEFAULT '',
  ng_keywords           TEXT NOT NULL DEFAULT '',        -- 改行区切り。含まれたら AI は答えずスタッフに回す

  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_tenants_bot_user ON tenants(line_bot_user_id) WHERE line_bot_user_id IS NOT NULL;

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,                          -- pbkdf2$<iter>$<salt_b64>$<hash_b64>
  role           TEXT NOT NULL DEFAULT 'owner',
  created_at     INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_tenant ON users(tenant_id);

CREATE TABLE customers (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  line_user_id     TEXT NOT NULL,
  display_name     TEXT NOT NULL DEFAULT '',
  note             TEXT NOT NULL DEFAULT '',
  last_message_at  INTEGER,
  created_at       INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_customers_line ON customers(tenant_id, line_user_id);
CREATE INDEX idx_customers_recent ON customers(tenant_id, last_message_at DESC);

CREATE TABLE messages (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id      TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  direction        TEXT NOT NULL,                        -- in | out
  author           TEXT NOT NULL,                        -- customer | ai | staff
  text             TEXT NOT NULL,
  line_message_id  TEXT,
  created_at       INTEGER NOT NULL
);

CREATE INDEX idx_messages_thread ON messages(tenant_id, customer_id, created_at DESC);
CREATE INDEX idx_messages_recent ON messages(tenant_id, created_at DESC);

-- 月ごとの AI 利用量。原価が売上を食わないようにここで頭を止める。
CREATE TABLE ai_usage (
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month          TEXT NOT NULL,                          -- YYYY-MM (JST)
  used_count     INTEGER NOT NULL DEFAULT 0,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, month)
);

-- LINE の webhook は再送されうるので、イベント ID で冪等化する。
CREATE TABLE processed_events (
  event_id    TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_processed_events_created ON processed_events(created_at);
