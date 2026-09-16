"""app/domain/rules.py の evaluate_depts テスト（仕様書 6.1）。

呼び出し側は配信済みだけを渡す契約なので、ここでは「渡された delivered だけが
集計に反映される（未配信は最初から渡さない）」ことも含めて確認する。
"""

from datetime import UTC, datetime, timedelta, timezone

from app.domain.rules import (
    DeliveredReport,
    evaluate_depts,
    next_delivery_at,
    severity_mix,
)


def by_dept(dept: str, result):  # noqa: ANN001
    return next(d for d in result if d.dept == dept)


def test_dept_with_no_delivered_reports_is_no_data() -> None:
    result = evaluate_depts([])
    d = by_dept("営業部", result)
    assert d.level is None
    assert d.label == "データなし"
    assert d.detail == "申告がありません"


def test_only_reports_passed_in_are_counted() -> None:
    # 呼び出し側の契約（配信済みだけを渡す）を体現するテスト。渡さなければ集計に出ない。
    result = evaluate_depts([DeliveredReport(target_id="u1", severity=1)])
    untouched = by_dept("開発部", result)
    assert untouched.level is None
    assert untouched.label == "データなし"


def test_single_report_has_no_concentration_or_distribution_note() -> None:
    # 開発部のメンバーは u4 のみ
    result = evaluate_depts([DeliveredReport(target_id="u4", severity=1)])
    d = by_dept("開発部", result)
    assert d.level == 1
    assert d.label == "5 段階中 1"
    assert d.detail == "重大度2以上が 0/1"


def test_two_or_more_reports_same_target_is_concentrated() -> None:
    result = evaluate_depts(
        [
            DeliveredReport(target_id="u2", severity=2),
            DeliveredReport(target_id="u2", severity=1),
        ]
    )
    d = by_dept("営業部", result)
    assert d.level == 3
    assert d.label == "5 段階中 3"
    assert d.detail == "重大度2以上が 1/2 ・ 特定の1名に集中"


def test_two_or_more_reports_different_targets_is_distributed() -> None:
    result = evaluate_depts(
        [
            DeliveredReport(target_id="u1", severity=1),
            DeliveredReport(target_id="u2", severity=1),
        ]
    )
    d = by_dept("営業部", result)
    assert d.level == 2
    assert d.label == "5 段階中 2"
    assert d.detail == "重大度2以上が 0/2 ・ 複数名に分散"


def test_label_never_says_level_to_avoid_clashing_with_severity() -> None:
    # 「レベル」は申告の重大度（仕様書 3.1）を指す語。部署評価に同じ表記を使うと、
    # 管理者が「営業部にレベル3の案件がある」と読み違える
    result = evaluate_depts(
        [
            DeliveredReport(target_id="u2", severity=2, author_id="u1"),
            DeliveredReport(target_id="u1", severity=2, author_id="u3"),
        ]
    )
    for d in result:
        assert "レベル" not in d.label


class TestMemberCountAndMinimum:
    """母数下限（仕様書 6.2）。人数の少ない単位では部署単位の判断をしない。"""

    def test_member_count_comes_from_the_roster_not_from_report_counts(self) -> None:
        result = evaluate_depts([])
        assert by_dept("営業部", result).member_count == 3
        assert by_dept("開発部", result).member_count == 1
        assert by_dept("管理部", result).member_count == 2

    def test_departments_below_the_minimum_are_marked(self) -> None:
        result = evaluate_depts([])
        assert by_dept("営業部", result).below_min_members is False
        assert by_dept("開発部", result).below_min_members is True
        assert by_dept("管理部", result).below_min_members is True


class TestDeptAlert:
    """部署アラート（仕様書 6.2）。件数ではなく人数で数え、分散しているときだけ出す。"""

    def test_alert_fires_for_multiple_authors_spread_across_targets(self) -> None:
        result = evaluate_depts(
            [
                DeliveredReport(target_id="u1", severity=1, author_id="u3"),
                DeliveredReport(target_id="u2", severity=2, author_id="u4"),
            ]
        )
        assert by_dept("営業部", result).alert is True

    def test_one_author_sending_repeatedly_does_not_fire(self) -> None:
        # 回数ベースだと一人が繰り返し送っただけで発火してしまう（仕様書 3.3）
        result = evaluate_depts(
            [
                DeliveredReport(target_id="u1", severity=2, author_id="u3"),
                DeliveredReport(target_id="u2", severity=2, author_id="u3"),
            ]
        )
        assert by_dept("営業部", result).alert is False

    def test_reports_concentrated_on_one_person_do_not_fire(self) -> None:
        # 1人に集まっていれば個人の問題。組織の問題として上げない（仕様書 6.1 の集中度）
        result = evaluate_depts(
            [
                DeliveredReport(target_id="u2", severity=2, author_id="u1"),
                DeliveredReport(target_id="u2", severity=2, author_id="u3"),
            ]
        )
        assert by_dept("営業部", result).alert is False

    def test_department_below_minimum_members_does_not_fire(self) -> None:
        # 管理部は2人なので、条件が揃っても部署単位では出さない
        result = evaluate_depts(
            [
                DeliveredReport(target_id="u5", severity=2, author_id="u1"),
                DeliveredReport(target_id="u6", severity=2, author_id="u3"),
            ]
        )
        d = by_dept("管理部", result)
        assert d.below_min_members is True
        assert d.alert is False

    def test_department_with_no_reports_has_no_alert(self) -> None:
        assert by_dept("営業部", evaluate_depts([])).alert is False


class TestSeverityMix:
    def test_counts_are_company_wide_totals(self) -> None:
        mix = severity_mix(
            [
                DeliveredReport(target_id="u2", severity=1),
                DeliveredReport(target_id="u4", severity=2),
                DeliveredReport(target_id="u5", severity=2),
            ]
        )
        assert mix.level1 == 1
        assert mix.level2 == 2

    def test_empty_is_zero(self) -> None:
        mix = severity_mix([])
        assert mix.level1 == 0
        assert mix.level2 == 0


class TestNextDeliveryAt:
    """まとめ配信は週1・月曜（仕様書 5.1）。"""

    def test_returns_a_future_monday_morning_in_jst(self) -> None:
        now = datetime(2026, 9, 16, 4, 30, tzinfo=UTC)

        at = next_delivery_at(now)

        assert at > now
        jst = at.astimezone(timezone(timedelta(hours=9)))
        assert jst.weekday() == 0
        assert (jst.hour, jst.minute, jst.second) == (9, 0, 0)

    def test_exactly_at_delivery_time_returns_the_following_week(self) -> None:
        # 配信時刻ちょうどのときは、その回は済んだものとして次の週を返す
        monday = next_delivery_at(datetime(2026, 9, 16, 4, 30, tzinfo=UTC))

        assert next_delivery_at(monday) - monday == timedelta(days=7)


def test_level_rises_when_all_reports_are_heavy() -> None:
    # heavy 比率が最大（3/3）でも、現行の計算式では 4 が上限（min(5, ...) は未到達の余白）
    result = evaluate_depts(
        [
            DeliveredReport(target_id="u2", severity=2),
            DeliveredReport(target_id="u1", severity=2),
            DeliveredReport(target_id="u3", severity=2),
        ]
    )
    d = by_dept("営業部", result)
    assert d.level == 4
