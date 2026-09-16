"""app/domain/users.py のテスト。

移植元: src/lib/data/users.test.ts。観点は同じにする。
"""

from app.domain.users import (
    USERS,
    User,
    hr_mentioned_in,
    is_power_sensitive,
    route_for,
    user_by_id,
    user_from_hint,
)


def u(uid: str) -> User:
    user = user_by_id(uid)
    assert user is not None
    return user


def person(uid: str, name: str, *, power: str = "peer", is_hr: bool = False) -> User:
    return User(id=uid, name=name, dept="営業部", title="メンバー", power=power, is_hr=is_hr)


class TestUserFromHint:
    def test_full_name_matches_regardless_of_whitespace(self) -> None:
        assert user_from_hint("佐藤 健一", USERS).id == "u2"
        assert user_from_hint("佐藤健一さん", USERS).id == "u2"

    def test_single_surname_match_returns_that_person(self) -> None:
        assert user_from_hint("佐藤部長", USERS).id == "u2"

    def test_two_people_with_same_surname_is_not_guessed(self) -> None:
        candidates = [*USERS, person("x1", "佐藤 次郎")]

        assert user_from_hint("佐藤さん", candidates) is None
        # フルネームなら同姓がいても決まる
        assert user_from_hint("佐藤 次郎", candidates).id == "x1"

    def test_empty_string_matches_nobody(self) -> None:
        assert user_from_hint("", USERS) is None

    def test_person_not_in_candidates_is_not_returned(self) -> None:
        without_sato = [x for x in USERS if x.id != "u2"]
        assert user_from_hint("佐藤部長", without_sato) is None


class TestHrMentionedIn:
    def test_returns_hr_when_surname_appears_anywhere(self) -> None:
        assert hr_mentioned_in("佐藤部長と伊藤さんに殴られた", USERS).id == "u6"

    def test_returns_hr_even_when_same_surname_general_employee_listed_first(self) -> None:
        candidates = [person("x2", "伊藤 翔"), *USERS]
        assert hr_mentioned_in("伊藤さんに殴られた", candidates).id == "u6"

    def test_none_when_hr_surname_absent(self) -> None:
        assert hr_mentioned_in("上司に殴られた", USERS) is None
        assert hr_mentioned_in("", USERS) is None


class TestRouteFor:
    def test_hr_bypasses_hr_notification_and_prefers_external(self) -> None:
        r = route_for(u("u6"))
        assert r.bypass_hr is True
        assert r.auto_send_off is True
        assert r.prefer_external is True
        assert isinstance(r.notice, str) and r.notice

    def test_hr_flag_overrides_executive_power(self) -> None:
        target = person("x3", "人事 役員", power="executive", is_hr=True)
        r = route_for(target)
        assert r.bypass_hr is True

    def test_executive_auto_send_off_and_prefers_external_without_hr_bypass(self) -> None:
        r = route_for(u("u5"))
        assert r.bypass_hr is False
        assert r.auto_send_off is True
        assert r.prefer_external is True
        assert isinstance(r.notice, str) and r.notice

    def test_manager_auto_send_off_only(self) -> None:
        r = route_for(u("u2"))
        assert r.bypass_hr is False
        assert r.auto_send_off is True
        assert r.prefer_external is False
        assert isinstance(r.notice, str) and r.notice

    def test_peer_has_no_notice(self) -> None:
        r = route_for(u("u1"))
        assert r.auto_send_off is False
        assert r.bypass_hr is False
        assert r.prefer_external is False
        assert r.notice is None


class TestIsPowerSensitive:
    def test_only_manager_and_executive(self) -> None:
        assert is_power_sensitive(u("u2")) is True  # 部長
        assert is_power_sensitive(u("u5")) is True  # 役員
        assert is_power_sensitive(u("u1")) is False  # メンバー
        assert is_power_sensitive(u("u6")) is False  # 人事（peer）
