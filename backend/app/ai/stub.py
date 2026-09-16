"""API キー無しでデモを動かすためのスタブ。移植元: src/lib/ai/stub.ts

GEMINI_API_KEY が未設定のときだけ使われる（client.is_stub_mode）。キーを設定すれば実 API に
切り替わり、このファイルは一切呼ばれない。UI の分岐（欠落の促し・特定リスク・レベル3停止・
権力差・まとめ配信）を確認するためのものであって、文面の質は実 API とは別物。
"""

import re
from collections.abc import Sequence
from typing import Literal

from app.domain.schemas import Action, Analysis, Composed

LEVEL3 = [
    "殴", "叩か", "蹴", "暴行", "脅", "殺す", "触ら", "性的", "わいせつ", "つきまと", "死にたい",
]
LEVEL2 = ["怒鳴", "無視", "仲間外れ", "毎回", "いつも", "続いて", "何度も", "残業", "押し付け"]

# 外から観察できる動詞。ここに当たらない記述は「評価」として observable=False にする
OBSERVABLE = [
    "遮", "割り込", "言わ", "言っ", "送っ", "送ら", "無視", "返さ", "返って", "割り当て",
    "怒鳴", "呼ば", "頼ま", "書か", "指示", "聞か", "笑わ", "denied",
]
# 話し方・接し方の様態。その場に居合わせた人が見聞きできるので行動として扱う。
# EVALUATIVE より先に見る（「態度が冷たい」は様態、「態度が悪い」は評価）
MANNER = ["口調", "言い方", "話し方", "きつ", "きびし", "厳し", "威圧", "高圧", "冷た", "そっけな"]
# 書き手の評価・相手の内面。相手が認知できないので行動として扱わない
EVALUATIVE = ["態度", "感じ", "やる気", "嫌", "見下", "馬鹿にさ", "冷た", "雰囲気"]

CONTEXT_HINTS = [
    "会議", "定例", "1on1", "ミーティング", "朝礼", "客先", "帰り", "昼",
    "先週", "先月", "昨日", "打ち合わせ", "席", "メール", "チャット",
]
IDENTIFYING = ["1on1", "二人", "2人", "個別", "面談", "私だけ", "自分だけ"]

_DATE_RE = re.compile(r"\d{1,2}\s*[/月]\s*\d{1,2}")
_ACTION_RE = re.compile(r"(れ|られ|した|します|ます)")


def has(s: str, words: list[str]) -> bool:
    return any(w in s for w in words)


def _severity_of(body: str) -> tuple[Literal[1, 2, 3], str]:
    if has(body, LEVEL3):
        return 3, "暴力・脅迫等に該当しうる"
    if has(body, LEVEL2):
        return 2, "継続性または強い負荷がある"
    return 1, "単発の言動と読める"


def _actions_of(body: str) -> list[Action]:
    """文を切り出して、観察可能な行動かどうかを振り分ける。"""
    sentences = [s.strip() for s in re.split(r"[。\n]", body) if s.strip()]
    source = sentences if sentences else [body]
    return [
        Action(
            description=s,
            observable=(
                has(s, OBSERVABLE)
                or has(s, MANNER)
                or (not has(s, EVALUATIVE) and bool(_ACTION_RE.search(s)))
            ),
        )
        for s in source
    ]


def stub_analyze(body: str, candidate_names: Sequence[str]) -> Analysis:
    severity, reason = _severity_of(body)
    actions = _actions_of(body)
    context_hit = next((w for w in CONTEXT_HINTS if w in body), None)
    target = next(
        (n for n in candidate_names if any(part in body for part in n.split(" "))),
        None,
    )
    identifying = has(body, IDENTIFYING) or bool(_DATE_RE.search(body))

    return Analysis(
        actions=actions,
        context=f"{context_hit}に関する場面" if context_hit else None,
        target_hint=target,
        severity=severity,
        severity_reason=reason,
        identifiability="high" if identifying else "low",
        identifiability_reason=(
            "その場にいた人数が限られ、書き手が絞り込まれる可能性があります" if identifying else ""
        ),
        organized=body.strip(),
    )


def stub_blur(text: str) -> str:
    text = re.sub(r"1on1|個別面談|面談", "業務上のやりとりの中", text)
    text = re.sub(r"二人きり|二人|2人", "少人数", text)
    text = re.sub(r"\d{1,2}\s*[/月]\s*\d{1,2}\s*日?", "先日", text)
    text = re.sub(r"私だけ|自分だけ", "一部の人", text)
    return text


def stub_compose(text: str) -> Composed:
    return Composed(
        what=text.strip(),
        why=(
            "こうした受け止めが生まれると、相手は次から発言や相談を控えるようになることがあります。"
            "結果として、必要な情報が共有されにくくなる場合があります。"
        ),
        how=(
            "一般に、こうした場面では、相手が話し終えるまで間を置く、意図が伝わっているかを確認する、"
            "といった対応が取られることがあります。"
        ),
    )
