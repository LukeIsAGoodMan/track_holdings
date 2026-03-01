"""
Tests for Phase 10a -- Voice/TTS Integration.

Covers:
  - build_narration() pure function: EN and ZH output, critical emphasis
  - MockTtsProvider: returns valid bytes
  - AudioCache: put/get, TTL expiry, cleanup
"""
from __future__ import annotations

import time

import pytest

from app.schemas.ai import DiagnosticItem
from app.services.voice_service import (
    AudioCache,
    MockTtsProvider,
    build_narration,
    _SILENT_MP3,
)


# -- Shared test data --------------------------------------------------------

def _diags(*specs: tuple[str, str]) -> list[DiagnosticItem]:
    """Build diagnostic items from (severity, category) tuples."""
    items = []
    for sev, cat in specs:
        items.append(DiagnosticItem(
            severity=sev,
            category=cat,
            title=f"Test {cat} {sev}",
            explanation=f"Explanation for {cat} at {sev} level with ratio 45.0.",
            suggestion=f"Hedge {cat} exposure by buying protective options.",
        ))
    return items


# =============================================================================
# TestBuildNarration — pure function tests
# =============================================================================

class TestBuildNarration:
    """build_narration() produces spoken narration from diagnostics."""

    def test_en_includes_assessment(self):
        diags = _diags(("critical", "delta"), ("info", "theta"))
        text = build_narration(diags, "Danger", "en")
        assert "Danger" in text
        assert "2 diagnostic findings" in text

    def test_en_critical_emphasized(self):
        """Critical items get 'Attention.' prefix."""
        diags = _diags(("critical", "delta"))
        text = build_narration(diags, "Danger", "en")
        assert "Attention. Critical:" in text

    def test_en_warning_not_emphasized(self):
        """Non-critical items have no 'Attention.' prefix."""
        diags = _diags(("warning", "gamma"))
        text = build_narration(diags, "Warning", "en")
        assert "Attention." not in text
        assert "Warning:" in text

    def test_en_includes_suggestion_for_critical(self):
        """Top critical suggestion included at end."""
        diags = _diags(("critical", "delta"), ("info", "theta"))
        text = build_narration(diags, "Danger", "en")
        assert "Recommended action:" in text
        assert "Hedge delta" in text

    def test_en_no_suggestion_when_no_critical(self):
        """No 'Recommended action' when all items are info/warning."""
        diags = _diags(("info", "theta"), ("warning", "vega"))
        text = build_narration(diags, "Warning", "en")
        assert "Recommended action:" not in text

    def test_en_single_finding_grammar(self):
        """Single finding uses singular 'finding' not 'findings'."""
        diags = _diags(("info", "theta"))
        text = build_narration(diags, "Safe", "en")
        assert "1 diagnostic finding detected" in text

    def test_en_includes_explanations(self):
        diags = _diags(("warning", "gamma"))
        text = build_narration(diags, "Warning", "en")
        assert "Explanation for gamma" in text
        assert "ratio 45.0" in text

    def test_zh_includes_assessment(self):
        diags = _diags(("critical", "delta"))
        text = build_narration(diags, "Danger", "zh")
        assert "\u5371\u9669" in text  # Danger in Chinese

    def test_zh_critical_emphasized(self):
        """Critical items get professional broadcaster emphasis."""
        diags = _diags(("critical", "delta"))
        text = build_narration(diags, "Danger", "zh")
        assert "\u91cd\u70b9\u5173\u6ce8" in text  # "Key focus"
        assert "\u4e25\u91cd\u7ea7\u522b" in text  # "Critical level"

    def test_zh_includes_suggestion(self):
        diags = _diags(("critical", "delta"))
        text = build_narration(diags, "Danger", "zh")
        assert "\u5206\u6790\u5e08\u5efa\u8bae" in text  # "Analyst recommendation"

    def test_zh_professional_opening(self):
        """ZH narration starts with professional broadcaster opening."""
        diags = _diags(("info", "theta"))
        text = build_narration(diags, "Safe", "zh")
        assert "\u5404\u4f4d\u6295\u8d44\u8005" in text  # "Dear investors"
        assert "\u672c\u6b21\u8bca\u65ad\u5171\u53d1\u73b0" in text  # "This diagnosis found"

    def test_defaults_to_english(self):
        """Unrecognized language falls back to English."""
        diags = _diags(("info", "theta"))
        text_en = build_narration(diags, "Caution", "en")
        text_other = build_narration(diags, "Caution", "fr")
        assert text_en == text_other


# =============================================================================
# TestMockTtsProvider
# =============================================================================

class TestMockTtsProvider:
    """MockTtsProvider returns valid silent MP3 bytes."""

    @pytest.mark.asyncio
    async def test_returns_bytes(self):
        provider = MockTtsProvider()
        result = await provider.synthesize("Hello world", "en-US-AriaNeural")
        assert isinstance(result, bytes)
        assert len(result) > 0

    @pytest.mark.asyncio
    async def test_returns_same_silent_mp3(self):
        provider = MockTtsProvider()
        result = await provider.synthesize("anything", "any-voice")
        assert result == _SILENT_MP3


# =============================================================================
# TestAudioCache
# =============================================================================

class TestAudioCache:
    """In-memory audio cache with TTL eviction."""

    def test_put_returns_hex_id(self):
        cache = AudioCache(ttl=60)
        audio_id = cache.put(b"fake-mp3-data")
        assert isinstance(audio_id, str)
        assert len(audio_id) == 32  # UUID hex

    def test_get_returns_stored_bytes(self):
        cache = AudioCache(ttl=60)
        data = b"test-audio-bytes"
        audio_id = cache.put(data)
        assert cache.get(audio_id) == data

    def test_get_returns_none_for_unknown_id(self):
        cache = AudioCache(ttl=60)
        assert cache.get("nonexistent") is None

    def test_ttl_expiry(self):
        """Expired entries return None."""
        cache = AudioCache(ttl=0.05)  # 50ms TTL
        audio_id = cache.put(b"data")
        assert cache.get(audio_id) == b"data"

        time.sleep(0.06)
        assert cache.get(audio_id) is None

    def test_cleanup_removes_expired(self):
        cache = AudioCache(ttl=0.05)
        cache.put(b"a")
        cache.put(b"b")
        assert cache.size == 2

        time.sleep(0.06)
        cache._cleanup()
        assert cache.size == 0

    def test_multiple_entries_independent(self):
        cache = AudioCache(ttl=60)
        id1 = cache.put(b"first")
        id2 = cache.put(b"second")
        assert id1 != id2
        assert cache.get(id1) == b"first"
        assert cache.get(id2) == b"second"
        assert cache.size == 2
