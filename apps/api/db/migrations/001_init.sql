-- 001_init.sql：时间信笺一期初始表结构（PostgreSQL 16）
-- 说明：
--   1) 幂等：全部使用 IF NOT EXISTS，可重复执行；
--   2) letters.content 只存 AES-256-GCM 密文信封 {v,alg,iv,tag,ct}，禁止存明文（US-009）；
--   3) 保管编号唯一性由数据库唯一索引兜底（部分索引，NULL 不参与），
--      服务层捕获唯一冲突后换号重试，不做顺序扫描。

CREATE TABLE IF NOT EXISTS letters (
  id                                  text PRIMARY KEY,
  user_id                             text NOT NULL,
  letter_type                         text NOT NULL,
  scene_id                            text,
  status                              text NOT NULL,
  content                             jsonb NOT NULL,
  delivery_date                       date,
  delivery_date_adjusted_from_feb29   boolean NOT NULL DEFAULT false,
  recipient_id                        text,
  moderation_record_id                text,
  custody_code                        text,
  custody_started_at                  timestamptz,
  review_reason                       text,
  created_at                          timestamptz NOT NULL,
  updated_at                          timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS letters_custody_code_key
  ON letters (custody_code)
  WHERE custody_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS letters_user_created_idx ON letters (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS letters_status_idx ON letters (status);

CREATE TABLE IF NOT EXISTS recipients (
  id              text PRIMARY KEY,
  user_id         text NOT NULL,
  email           text NOT NULL,
  wechat_nickname text,
  phone           text,
  is_self         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS recipients_user_idx ON recipients (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS consents (
  id           text PRIMARY KEY,
  user_id      text NOT NULL,
  type         text NOT NULL,
  version      text NOT NULL,
  granted_at   timestamptz NOT NULL,
  withdrawn_at timestamptz,
  source       text NOT NULL
);

-- 同一用户同一类型至多一条有效同意（等价于内存实现的 findActive 语义）
CREATE UNIQUE INDEX IF NOT EXISTS consents_active_key
  ON consents (user_id, type)
  WHERE withdrawn_at IS NULL;

CREATE INDEX IF NOT EXISTS consents_user_idx ON consents (user_id, granted_at);

CREATE TABLE IF NOT EXISTS moderation_records (
  id               text PRIMARY KEY,
  letter_id        text NOT NULL,
  decision         text NOT NULL,
  hits             jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewer_id      text,
  reason           text,
  created_at       timestamptz NOT NULL,
  resolved_at      timestamptz
);

CREATE INDEX IF NOT EXISTS moderation_records_letter_idx
  ON moderation_records (letter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS moderation_records_decision_idx
  ON moderation_records (decision, created_at);

CREATE TABLE IF NOT EXISTS orders (
  id           text PRIMARY KEY,
  user_id      text NOT NULL,
  letter_id    text NOT NULL UNIQUE,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  status       text NOT NULL,
  created_at   timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, created_at DESC);
