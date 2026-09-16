"""移植元: src/lib/ai/analyze.ts"""

from collections.abc import Sequence

from app.ai.client import call_structured, is_stub_mode
from app.ai.stub import stub_analyze
from app.domain.schemas import Analysis


def _prompt(body: str, candidate_names: Sequence[str]) -> str:
    return f"""あなたは職場フィードバックツールの解析エンジンです。従業員が書いた訴えを解析し、\
JSONのみを返してください。前置き・説明・マークダウンは一切出力しないこと。

## 解析の観点

1. actions: 相手が「した」こと。判定軸は外から観察できるかどうか。
   - 観察できる: 遮る、言う、送る、無視する、割り当てる、返さない
   - 観察できない: 態度が悪い、感じが悪い、やる気がない、私を嫌っている（これは書き手の評価であり、\
相手は認知できない）
   「〜しない」という不作為（挨拶を返さない、自分にだけ声をかけない）は観察可能な行動として扱う。
   評価と行動が混ざっている場合（見下すような言い方をされた）は、行動部分だけを description に残す。
   観察できる記述が無い場合、actions は空配列にする。

2. context: いつ・どこで・どんな状況か。日付の精度は不要。「先週の定例で」程度で十分。\
無ければ null。

3. target_hint: 文中に相手の名前があれば返す。候補: {"、".join(candidate_names)}。無ければ null。

4. severity:
   - 3 = 暴行・傷害、性的強要・わいせつ行為、脅迫、ストーカー行為、自死をほのめかす記述。\
犯罪または緊急対応の領域。
   - 2 = 継続的な暴言、無視・仲間外し、過大/過小な業務要求、プライバシー侵害。
   - 1 = 不適切な冗談、配慮を欠いた発言、単発の言動、業務上の不満。
   迷ったら重い方に寄せること。軽く見積もるミスの方が危険。

5. identifiability: この書き方だと、相手が「誰が書いたか」を推測できてしまう度合い。
   1on1、二人きりの場面、特定の日付、その人しか知り得ない情報などがあると high。

6. organized: 送信者が書いた内容を、相手が読む形に整えた文面。
   - 送信者が使った言葉をできるだけ残す。言い換えて意味を変えない。
   - 要望や感情を勝手に追加しない。事実として書かれたことだけ。
   - 1〜3文。

## 出力するJSON
{{
  "actions": [{{"description": "行動の記述", "observable": true}}],
  "context": "場面" または null,
  "target_hint": "氏名" または null,
  "severity": 1,
  "severity_reason": "判定理由を20字程度で",
  "identifiability": "low" | "medium" | "high",
  "identifiability_reason": "推測されうる理由を30字程度で。lowなら空文字",
  "organized": "整えた文面"
}}

## 解析対象
\"\"\"
{body}
\"\"\""""


async def analyze(body: str, candidate_names: Sequence[str]) -> Analysis:
    """行動・場面・対象者の抽出、重大度判定、特定リスク判定を1回の呼び出しでまとめて返す。"""
    if is_stub_mode():
        return stub_analyze(body, candidate_names)
    return await call_structured(_prompt(body, candidate_names), Analysis, max_tokens=1200)


def has_observable_action(a: Analysis) -> bool:
    """観察可能な行動が取れているか。分岐（仕様書 2.6）の判定に使う。"""
    return any(x.observable for x in a.actions)
