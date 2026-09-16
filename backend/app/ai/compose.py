"""移植元: src/lib/ai/compose.ts"""

from app.ai.client import call_structured, is_stub_mode
from app.ai.stub import stub_compose
from app.domain.schemas import Composed


def _prompt(text: str) -> str:
    return f"""あなたは職場フィードバックツールの文面生成エンジンです。匿名で寄せられた指摘を、\
受け取った人が行動を変えられる形に整えます。JSONのみを返してください。

## 絶対の原則
- 断定しない。「あなたはハラスメントをしました」ではなく「こういう受け止めをした人がいます」。\
事実認定はしていない。
- 人格ではなく行為を指す。「配慮のない人だ」ではなく「この場面でのこの行為」。
- 弁明の余地を残す。心当たりがない、意図が違った、という可能性は常にある。
- 責めない。相手を防御姿勢にさせた時点で失敗する。目的は認知であって断罪ではない。
- how は送信者の要望として書かない。「〇〇さんはこうしてほしいそうです」ではなく\
「一般に、こうした場面では」と切り離す。
- 送信者が誰かを推測させる情報（人数、部署、立場、時期の特定）を書き足さない。

## 出力するJSON
{{
  "what": "指摘されている行為を1〜2文で。送信者の記述をほぼそのまま。",
  "why": "その行為がなぜ問題になりうるか。行為と影響を接続する。2〜3文。",
  "how": "一般的な対応の方向。2文程度。命令形にしない。"
}}

## 指摘内容
\"\"\"
{text}
\"\"\""""


async def compose(text: str) -> Composed:
    """受信者向けフィードバック（what / why / how）を生成する。"""
    if is_stub_mode():
        return stub_compose(text)
    return await call_structured(_prompt(text), Composed, max_tokens=1000)
