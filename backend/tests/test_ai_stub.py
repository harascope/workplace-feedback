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


class TestStubAnalyzeRephraseHint:
    """身体的特徴・容姿だけの入力は actions を埋めず、言い換え案だけを出す。"""

    def test_physical_trait_only_yields_no_observable_action_and_a_hint(self) -> None:
        a = stub_analyze("部長の足が臭すぎる", [])
        assert not any(x.observable for x in a.actions)
        assert a.rephrase_hint is not None

    def test_rephrase_hint_is_never_folded_into_actions(self) -> None:
        """AI が actions を勝手に埋めて人格攻撃を行動として通してはならない。"""
        a = stub_analyze("部長の足が臭すぎる", [])
        assert a.rephrase_hint not in [x.description for x in a.actions]

    def test_observable_action_present_yields_no_hint(self) -> None:
        """行動が取れているときは言い換え案を出さない（出す必要が無い）。"""
        a = stub_analyze("会議で発言を遮られた", [])
        assert any(x.observable for x in a.actions)
        assert a.rephrase_hint is None

    def test_pure_feeling_with_no_trait_mention_yields_no_hint(self) -> None:
        """好悪や感情だけの入力（なんかつらい等）には言い換える対象が無いので出さない。"""
        a = stub_analyze("なんかつらい", [])
        assert not any(x.observable for x in a.actions)
        assert a.rephrase_hint is None


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
