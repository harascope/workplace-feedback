"""利用者単位のレート制限（docs/api.md「レート制限」節）。

api は web コンテナからしか到達しない（外部公開していない）ため、slowapi 既定の
get_remote_address だけでは全利用者が同じ送信元 IP に見え、上限がサイト全体で共有
されてしまう。web（src/lib/api.ts）が付与する X-Client-Id ヘッダを優先し、無ければ
get_remote_address にフォールバックする。
"""

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

# ヘッダはクライアントが自由に送れる値。任意の長大な文字列でメモリを圧迫されないよう切り詰める。
_MAX_CLIENT_ID_LEN = 200


def client_id_key(request: Request) -> str:
    """X-Client-Id があればそれを、無ければ送信元 IP をレート制限のキーにする。"""
    client_id = request.headers.get("x-client-id", "").strip()
    if client_id:
        return client_id[:_MAX_CLIENT_ID_LEN]
    return get_remote_address(request)


limiter = Limiter(key_func=client_id_key)
