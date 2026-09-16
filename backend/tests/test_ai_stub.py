"""app/ai/stub.py のテスト。GEMINI_API_KEY 未設定時のキーワード判定を確認する。"""

from app.ai.stub import stub_analyze, stub_compose


class TestStubAnalyzeSeverity:
    def test_level3_keyword_yields_severity_3(self) -> None:
        a = stub_analyze("上司に殴られた", [])
        assert a.severity == 3
        assert a.severity_reason == "暴力・脅迫等に該当しうる"

    def test_level2_keyword_yields_severity_2(self) -> None:
        a = stub_analyze("いつも怒鳴られる", [])
        assert a.severity == 2

    def test_no_keyword_yields_severity_1(self) -> None:
        a = stub_analyze("会議で発言を遮られた", [])
        assert a.severity == 1


class TestStubAnalyzeIdentifiability:
    def test_identifying_keyword_yields_high(self) -> None:
        a = stub_analyze("1on1で強く言われた", [])
        assert a.identifiability == "high"
        assert a.identifiability_reason != ""

    def test_no_identifying_keyword_yields_low(self) -> None:
        a = stub_analyze("会議で発言を遮られた", [])
        assert a.identifiability == "low"
        assert a.identifiability_reason == ""


class TestStubCompose:
    def test_composes_what_why_how(self) -> None:
        c = stub_compose("会議で発言を遮られた")
        assert c.what == "会議で発言を遮られた"
        assert isinstance(c.why, str) and c.why
        assert isinstance(c.how, str) and c.how
        # why/how は AI が担う部分。送信者の要望として書かない（仕様書 5.2）ため
        # what とは別の固定文言になる
        assert c.why != c.what
        assert c.how != c.what
