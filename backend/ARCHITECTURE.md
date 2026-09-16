# backend の内部インターフェース

層ごとに担当を分けて並行実装するための取り決め。**ここに書いたシグネチャは変えない。**
HTTP の契約は `../docs/api.md`。振る舞いの根拠は `../docs/spec.md`。

移植元（挙動と文言をそのまま移す）:
`src/lib/store.ts` / `src/lib/data/users.ts` / `src/lib/ai/{client,analyze,blur,compose,stub,schemas}.ts` / `src/app/actions.ts`

```
app/
  domain/     users.py  schemas.py  rules.py      … 依存なし（純粋なロジック）
  ai/         client.py analyze.py blur.py compose.py stub.py   … domain.schemas だけに依存
  db/         models.py session.py  repositories/{reports,inbox,escalations}.py  … domain.schemas に依存
  api/        routes.py limits.py                  … 上の3つを呼ぶだけ
  main.py                                          … 組み立て・起動時処理
alembic/
tests/
```

## app/domain/schemas.py（Pydantic v2。他の層はここを import する）

```python
class Action(BaseModel):        description: str; observable: bool
class Analysis(BaseModel):      actions: list[Action]; context: str | None; target_hint: str | None
                                severity: Literal[1, 2, 3]; severity_reason: str
                                identifiability: Literal["low", "medium", "high"]
                                identifiability_reason: str; organized: str
class Composed(BaseModel):      what: str; why: str; how: str
class InboxItem(BaseModel):     id: str; body: str; has_context: bool
                                composed: Composed | None; response: Literal["ack", "dispute"] | None
class DeptEval(BaseModel):      dept: str; level: int | None; label: str; detail: str
class EscalationView(BaseModel): id: str; author_name: str; raw_body: str
                                severity_reason: str; created_at: datetime
class AdminView(BaseModel):     pending: int; depts: list[DeptEval]; escalations: list[EscalationView]
```

## app/domain/users.py

```python
@dataclass(frozen=True)
class User: id: str; name: str; dept: str; title: str; power: Literal["peer","manager","executive"]; is_hr: bool = False

@dataclass(frozen=True)
class Route: auto_send_off: bool; bypass_hr: bool; notice: str | None; prefer_external: bool

USERS: list[User]                 # src/lib/data/users.ts と同じ 6 人・同じ文言
EXTERNAL_CONTACTS: list[str]

def user_by_id(uid: str) -> User | None
def surname(u: User) -> str
def user_from_hint(hint: str, candidates: Sequence[User]) -> User | None   # フルネーム優先、姓は1人だけ一致のとき
def hr_mentioned_in(text: str, candidates: Sequence[User]) -> User | None  # 姓の一致で人事担当を拾う
def is_power_sensitive(u: User) -> bool
def route_for(target: User) -> Route
```

## app/domain/rules.py

```python
@dataclass(frozen=True)
class DeliveredReport: target_id: str; severity: int   # 集計に要る列だけ

def evaluate_depts(delivered: Sequence[DeliveredReport]) -> list[DeptEval]
# 配信済みだけを渡すこと。申告ゼロ → level None・label "データなし"
# 1件だけなら detail に集中・分散を付けない
```

## app/ai/（すべて async。失敗は例外。呼び出し側が 502 に変換する）

```python
# client.py
def is_stub_mode() -> bool                      # GEMINI_API_KEY 未設定なら True
def extract_json(text: str) -> Any              # ```json の剥がし＋最外 {} の抽出
async def call_structured[T: BaseModel](prompt: str, model: type[T], *, max_tokens: int = 1200, max_retries: int = 2) -> T
# 検証に失敗したら理由を添えて再試行。合計 3 回まで

# analyze.py / blur.py / compose.py
async def analyze(body: str, candidate_names: Sequence[str]) -> Analysis
async def blur(text: str) -> str
async def compose(body: str) -> Composed
# それぞれ先頭で is_stub_mode() を見て stub.py に分岐する

# stub.py（キーワード判定。src/lib/ai/stub.ts をそのまま移植）
def stub_analyze(body: str, candidate_names: Sequence[str]) -> Analysis
def stub_blur(text: str) -> str
def stub_compose(body: str) -> Composed
```

## app/db/

```python
# models.py … テーブル定義は docs/api.md の「データ」節どおり
class Report(Base): ...      # __tablename__ = "reports"
class Escalation(Base): ...  # __tablename__ = "escalations"

# session.py
def make_engine(url: str) -> AsyncEngine
SessionFactory = async_sessionmaker[AsyncSession]
async def get_session() -> AsyncIterator[AsyncSession]   # FastAPI の依存性

# repositories/reports.py
async def add_report(s, *, author_id: str, target_id: str, severity: int, body: str, raw_body: str, has_context: bool) -> str
async def cancel_report(s, report_id: str, author_id: str) -> bool   # 本人かつ pending のときだけ True
async def list_pending(s) -> list[Report]
async def mark_delivered(s, report_id: str, composed: dict | None) -> None
async def pending_count(s) -> int
async def list_delivered_for_eval(s) -> list[DeliveredReport]
async def set_response(s, report_id: str, kind: Literal["ack", "dispute"]) -> None
async def purge_old(s, days: int) -> int
async def reset_to_seed(s) -> None    # 配信済み1件・未配信1件・引き継ぎ0件

# repositories/inbox.py … 匿名性の要。ここ以外で受信箱を組み立てない
async def list_inbox(s, user_id: str) -> list[InboxItem]
# select(Report.id, Report.body, Report.has_context, Report.composed, Report.response) の形にし、
# author_id と raw_body を **クエリに含めない**

# repositories/escalations.py
async def add_escalation(s, *, author_id: str, raw_body: str, severity_reason: str) -> str
async def list_escalations(s) -> list[EscalationView]   # author_name は users.py で引く
```

## app/api/

```python
# limits.py
limiter: Limiter                                  # slowapi、IP 単位
# routes.py … docs/api.md のエンドポイントを1対1で実装。上の関数を呼ぶだけで、ロジックを持たない
router: APIRouter

# main.py
app: FastAPI          # router 登録、limiter 登録、起動時に purge_old、1日1回の定期実行
```

## 設定（app/config.py）

```python
class Settings(BaseSettings):
    database_url: str
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.1-flash-lite"
    retention_days: int = 30
settings: Settings
```

## 決めごと

- 例外は各層で握りつぶさない。API 層だけが HTTP の状態コードに変換する
- ログに本文・`author_id`・鍵を出さない
- テストは実 API を呼ばない（`app.ai` をモックする）。DB テストは SQLite（aiosqlite）で回せる形にし、jsonb など固有機能に依存しない
