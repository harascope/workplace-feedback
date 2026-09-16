-- 職場フィードバックツール スキーマ
--
-- Supabase の SQL Editor に貼り付けて実行する。
-- 再実行しても壊れないよう、すべて IF NOT EXISTS / OR REPLACE で書いている。
--
-- 匿名性の設計（仕様書 1.2 / 8章の原則5）:
--   author_id は reports テーブルにしか存在しない。
--   受信者に渡すデータは inbox_items ビュー経由でしか取得できず、
--   このビューは author_id を SELECT していない。
--   さらに anon ロールには reports への権限を与えず、ビューだけを許可する。
--   アプリの型で守るだけでなく、DB の権限でも送信者 ID に到達できない状態にする。

-- ---------------------------------------------------------------------------
-- 申告
-- ---------------------------------------------------------------------------
create table if not exists reports (
  id            text primary key,
  author_id     text not null,
  -- 対象者が特定されない申告は null。部署アラートの集計対象になる（仕様書 6.2）
  target_id     text,
  -- 送信者の所属。対象者なしの申告を部署に紐づけるために持つ
  author_dept   text not null,
  severity      int  not null check (severity between 1 and 3),
  -- 送信者が確認した、整理後の文面
  body          text not null,
  -- 元の記述。検証のため保存する（仕様書 2.8）。受信画面には出さない
  raw_body      text not null,
  -- 場面が抽出できたか。受信側の補足表示に使う
  has_context   boolean not null default false,
  -- 観察可能な行動が抽出できたか。閾値判定の分岐に使う（仕様書 3.3）
  has_action    boolean not null default false,
  status        text not null default 'pending'
                check (status in ('pending', 'delivered', 'cancelled')),
  composed      jsonb,
  response      text check (response in ('ack', 'dispute')),
  -- 受信者の反論。送信者には自動送信しない（仕様書 5.5）
  dispute_note  text,
  created_at    timestamptz not null default now(),
  delivered_at  timestamptz,
  read_at       timestamptz,
  -- レベル3で本人が同意した場合のみ真（仕様書 3.1）
  hr_escalated  boolean not null default false,
  -- 報復事案として別トラックに乗った申告（仕様書 3.2）
  retaliation   boolean not null default false
);

create index if not exists idx_reports_target  on reports (target_id, status);
create index if not exists idx_reports_author  on reports (author_id);
create index if not exists idx_reports_created on reports (created_at);

-- ---------------------------------------------------------------------------
-- フォローアップ（仕様書 3.2）
-- 送信の3日後・2週間後・1ヶ月後に状況を確認する
-- ---------------------------------------------------------------------------
create table if not exists followups (
  id          text primary key,
  report_id   text not null references reports (id) on delete cascade,
  stage       text not null check (stage in ('d3', 'w2', 'm1')),
  due_at      timestamptz not null,
  answer      text check (answer in ('improved', 'unchanged', 'worse')),
  answered_at timestamptz
);

create index if not exists idx_followups_report on followups (report_id);

-- ---------------------------------------------------------------------------
-- 企業設定（仕様書 6.3）。1行だけ持つ
-- ---------------------------------------------------------------------------
create table if not exists settings (
  id   int primary key default 1 check (id = 1),
  data jsonb not null
);

-- ---------------------------------------------------------------------------
-- 設定変更履歴（仕様書 6.3）
-- 「会社は対応していたか」が後から問われるため、警告の有無まで残す
-- ---------------------------------------------------------------------------
create table if not exists settings_log (
  id         text primary key,
  changed_at timestamptz not null default now(),
  actor      text not null,
  field      text not null,
  before_val text not null,
  after_val  text not null,
  warned     boolean not null default false
);

-- ---------------------------------------------------------------------------
-- 閾値エスカレーション（仕様書 3.3）
-- 同一人物への申告が異なる複数名から出たときに1行作る
-- ---------------------------------------------------------------------------
create table if not exists escalations (
  id             text primary key,
  target_id      text not null,
  kind           text not null check (kind in ('concrete', 'vague')),
  reporter_count int  not null,
  created_at     timestamptz not null default now(),
  -- 通報者への通知が済んだか（仕様書 3.3「通報者への通知」）
  notified       boolean not null default false
);

create index if not exists idx_escalations_target on escalations (target_id);

-- ---------------------------------------------------------------------------
-- 部署アラート（仕様書 6.2）
-- 件数は保存するが、画面には出さない。「複数の申告があります」とだけ表示する
-- ---------------------------------------------------------------------------
create table if not exists dept_alerts (
  id          text primary key,
  dept        text not null,
  report_count int not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 受信者に見せる形（匿名性の要）
--
-- author_id と raw_body を含めない。
-- 受信画面はこのビューしか参照しない。
-- ---------------------------------------------------------------------------
create or replace view inbox_items as
select
  id,
  target_id,
  body,
  has_context,
  composed,
  response,
  delivered_at
from reports
where status = 'delivered';

-- ---------------------------------------------------------------------------
-- 権限
--
-- 認証を実装していないため RLS でユーザーを区別できない。
-- そこで「anon ロールからは送信者 ID に到達できない」ことを権限で担保する。
-- サーバー側（Server Actions）は service_role で接続するので影響を受けない。
-- ---------------------------------------------------------------------------
alter table reports      enable row level security;
alter table followups    enable row level security;
alter table settings     enable row level security;
alter table settings_log enable row level security;
alter table escalations  enable row level security;
alter table dept_alerts  enable row level security;

-- ポリシーを一つも作らないため、anon / authenticated からは全行が見えない。
-- service_role は RLS をバイパスする。

-- ビューへの参照も明示的に剥がしておく
revoke all on inbox_items from anon, authenticated;
revoke all on reports     from anon, authenticated;

-- ---------------------------------------------------------------------------
-- デモ用の初期データ
-- ---------------------------------------------------------------------------
insert into settings (id, data)
values (1, '{
  "deliveryIntervalDays": 7,
  "maxPerDelivery": 3,
  "rateLimitPerDay": 1,
  "rateLimitUnit": "perTarget",
  "thresholdConcrete": 2,
  "thresholdVague": 3,
  "thresholdVagueWindowDays": 90,
  "deptAlertMinMembers": 5
}'::jsonb)
on conflict (id) do nothing;
