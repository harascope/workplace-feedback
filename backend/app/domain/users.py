"""デモ用の社員名簿と、対象者まわりの純粋ロジック。

移植元: src/lib/data/users.ts（文言はそのまま移す）
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class User:
    id: str
    name: str
    dept: str
    title: str
    power: Literal["peer", "manager", "executive"]
    is_hr: bool = False
    """HR 担当者かどうか。この人物が対象のときは HR 通知をバイパスする（仕様書 3.4）。"""


@dataclass(frozen=True)
class Route:
    """送信先に応じた経路（仕様書 3.4）。"""

    auto_send_off: bool
    """自動送信のデフォルトを OFF にするか。"""
    bypass_hr: bool
    """HR への通知をバイパスするか。"""
    notice: str | None
    """画面に出す注意文。None なら注意不要。"""
    prefer_external: bool
    """社外窓口を優先案内するか。"""


# デモ用の社員名簿。認証の代わりに人物セレクタで切り替える。
USERS: list[User] = [
    User(id="u1", name="山田 太郎", dept="営業部", title="メンバー", power="peer"),
    User(id="u2", name="佐藤 健一", dept="営業部", title="部長", power="manager"),
    User(id="u3", name="鈴木 花子", dept="営業部", title="メンバー", power="peer"),
    User(id="u4", name="高橋 みどり", dept="開発部", title="メンバー", power="peer"),
    User(id="u5", name="田中 誠", dept="管理部", title="役員", power="executive"),
    User(id="u6", name="伊藤 彩", dept="管理部", title="人事担当", power="peer", is_hr=True),
]

# 外部相談窓口。レベル3および権力差の大きい相手で案内する。
EXTERNAL_CONTACTS: list[str] = [
    "各都道府県労働局 総合労働相談コーナー",
    "警察相談専用電話 #9110",
    "法テラス（弁護士相談）",
]


def user_by_id(uid: str) -> User | None:
    return next((u for u in USERS if u.id == uid), None)


def surname(u: User) -> str:
    return u.name.split(" ")[0]


def user_from_hint(hint: str, candidates: Sequence[User]) -> User | None:
    """AI が読み取った対象者の手がかり（「佐藤さん」など）を、候補の人物に突き合わせる。

    フルネームで一致しなければ姓で探す。同じ姓が複数いるときは決めつけず、利用者に選ばせる。
    """
    compact = re.sub(r"\s", "", hint)
    full = next((u for u in candidates if re.sub(r"\s", "", u.name) in compact), None)
    if full is not None:
        return full
    by_surname = [u for u in candidates if surname(u) in hint]
    return by_surname[0] if len(by_surname) == 1 else None


def hr_mentioned_in(text: str, candidates: Sequence[User]) -> User | None:
    """文中のどこかに人事担当の姓が出ていれば、その人物を返す。

    人事への引き継ぎを止める判定に使う。対象者の読み取りが外れたり複数名が書かれていても、
    当事者に届く側へは倒さないよう、手がかりの先頭一致には頼らない。
    姓だけで拾うので、同じ姓の一般社員がいても迂回する側に倒れる。
    """
    return next((u for u in candidates if u.is_hr and surname(u) in text), None)


def is_power_sensitive(u: User) -> bool:
    """自動送信のデフォルトが OFF になる相手（仕様書 3.4）。送信自体は止めない。"""
    return u.power in ("manager", "executive")


def route_for(target: User) -> Route:
    """送信先に応じた経路（仕様書 3.4）。

    HR 担当者自身が対象のとき、HR 通知を経由すると当事者に届いてしまうため、
    社外窓口のみを案内する。この経路が無いとツールが機能不全になる。
    """
    if target.is_hr:
        return Route(
            auto_send_off=True,
            bypass_hr=True,
            prefer_external=True,
            notice=(
                "この相手は人事担当です。人事を経由した相談は、相手本人に届くことになります。"
                "この送信は人事へ通知されません。社外の窓口に相談することも検討してください。"
            ),
        )
    if target.power == "executive":
        return Route(
            auto_send_off=True,
            bypass_hr=False,
            prefer_external=True,
            notice=(
                "役員への匿名フィードバックは、報復のリスクが高くなります。"
                "この設定では自動送信が既定でオフになっていますが、送ることはできます。"
                "社外の窓口もあわせて案内します。"
            ),
        )
    if target.power == "manager":
        return Route(
            auto_send_off=True,
            bypass_hr=False,
            prefer_external=False,
            notice=(
                "直属の上司にあたる相手への匿名フィードバックは、報復のリスクが高くなります。"
                "この設定では自動送信が既定でオフになっていますが、送ることはできます。"
            ),
        )
    return Route(auto_send_off=False, bypass_hr=False, prefer_external=False, notice=None)
