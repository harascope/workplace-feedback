"""移植元: src/lib/ai/blur.ts"""

from pydantic import BaseModel

from app.ai.client import call_structured, is_stub_mode
from app.ai.stub import stub_blur


class _BlurResult(BaseModel):
    blurred: str


def _prompt(text: str) -> str:
    return f"""次の文面を、書き手が誰か推測されにくいように書き直してください。

条件:
- 特定の日付、二人きりの場面、その人しか知り得ない情報をぼかす
- 何があったか（行動）は残す。ここを消すと相手が認知できなくなる
- 書き手の言葉づかいはできるだけ残す

JSONのみを返すこと: {{"blurred": "書き直した文面"}}

対象:
\"\"\"
{text}
\"\"\""""


async def blur(text: str) -> str:
    """特定されにくい表現へ書き直す。採用するかどうかの判断は呼び出し元（＝本人）に残す。"""
    if is_stub_mode():
        return stub_blur(text)
    r = await call_structured(_prompt(text), _BlurResult, max_tokens=800)
    return r.blurred
