"""app/domain/rules.py の evaluate_depts テスト（仕様書 6.1）。

呼び出し側は配信済みだけを渡す契約なので、ここでは「渡された delivered だけが
集計に反映される（未配信は最初から渡さない）」ことも含めて確認する。
"""

from app.domain.rules import DeliveredReport, evaluate_depts


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
    assert d.label == "レベル 1"
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
    assert d.label == "レベル 3"
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
    assert d.label == "レベル 2"
    assert d.detail == "重大度2以上が 0/2 ・ 複数名に分散"


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
