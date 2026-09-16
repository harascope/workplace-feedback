"""IP 単位のレート制限（docs/api.md「レート制限」節）。"""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
