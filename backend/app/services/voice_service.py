"""
Phase 10a -- Voice/TTS Integration.

Pure function:
  build_narration(diagnostics, overall, language) -> str

TTS providers:
  TtsProvider(ABC)        -- abstract interface
  EdgeTtsProvider         -- Microsoft Edge TTS (free, async, MP3)
  MockTtsProvider         -- returns silent MP3 for testing

Audio cache:
  AudioCache              -- in-memory dict with TTL eviction
"""
from __future__ import annotations

import abc
import io
import logging
import time
import uuid

from app.schemas.ai import DiagnosticItem

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Severity labels for narration
# ---------------------------------------------------------------------------

_SEV_LABEL_EN = {"critical": "Critical", "warning": "Warning", "info": "Info"}
_SEV_LABEL_ZH = {"critical": "严重", "warning": "警告", "info": "信息"}

_ASSESS_LABEL_EN = {
    "Danger": "Danger", "Warning": "Warning",
    "Caution": "Caution", "Safe": "Safe",
}
_ASSESS_LABEL_ZH = {
    "Danger": "危险", "Warning": "警告",
    "Caution": "注意", "Safe": "安全",
}


# ---------------------------------------------------------------------------
# Pure function: build narration text
# ---------------------------------------------------------------------------

def build_narration(
    diagnostics: list[DiagnosticItem],
    overall_assessment: str,
    language: str = "en",
) -> str:
    """
    Convert AI diagnostics into spoken narration text.

    Pure function — no I/O, fully testable.
    Critical diagnostics are emphasized with severity prefix.

    Args:
        diagnostics: list of DiagnosticItem from AiInsight
        overall_assessment: "Safe" | "Caution" | "Warning" | "Danger"
        language: "en" or "zh"

    Returns:
        Human-readable narration string suitable for TTS synthesis.
    """
    if language == "zh":
        return _build_narration_zh(diagnostics, overall_assessment)
    return _build_narration_en(diagnostics, overall_assessment)


def _build_narration_en(
    diagnostics: list[DiagnosticItem],
    overall_assessment: str,
) -> str:
    assess = _ASSESS_LABEL_EN.get(overall_assessment, overall_assessment)
    n = len(diagnostics)
    parts: list[str] = [
        f"Portfolio risk assessment: {assess}.",
        f"{n} diagnostic finding{'s' if n != 1 else ''} detected.",
    ]

    for d in diagnostics:
        sev = _SEV_LABEL_EN.get(d.severity, d.severity)
        if d.severity == "critical":
            parts.append(f"Attention. {sev}: {d.title}. {d.explanation}")
        else:
            parts.append(f"{sev}: {d.title}. {d.explanation}")

    # Add top suggestion for critical items
    critical = [d for d in diagnostics if d.severity == "critical"]
    if critical:
        parts.append(f"Recommended action: {critical[0].suggestion}")

    return " ".join(parts)


def _build_narration_zh(
    diagnostics: list[DiagnosticItem],
    overall_assessment: str,
) -> str:
    """Professional Chinese financial broadcaster tone."""
    assess = _ASSESS_LABEL_ZH.get(overall_assessment, overall_assessment)
    n = len(diagnostics)

    # Professional opening
    parts: list[str] = [
        f"\u5404\u4f4d\u6295\u8d44\u8005\uff0c\u7ec4\u5408\u98ce\u9669\u8bc4\u4f30\u7ed3\u679c\uff1a{assess}\u3002",
        f"\u672c\u6b21\u8bca\u65ad\u5171\u53d1\u73b0{n}\u9879\u8981\u70b9\u3002",
    ]

    # Critical items get emphasis
    critical = [d for d in diagnostics if d.severity == "critical"]
    warnings = [d for d in diagnostics if d.severity == "warning"]
    infos = [d for d in diagnostics if d.severity == "info"]

    for d in critical:
        parts.append(
            f"\u91cd\u70b9\u5173\u6ce8\uff0c"
            f"\u4e25\u91cd\u7ea7\u522b\u2014\u2014{d.title}\u3002"
            f"{d.explanation}"
        )

    for d in warnings:
        parts.append(
            f"\u8b66\u544a\u7ea7\u522b\u2014\u2014{d.title}\u3002"
            f"{d.explanation}"
        )

    for d in infos:
        parts.append(f"\u4fe1\u606f\u63d0\u793a\uff1a{d.title}\u3002{d.explanation}")

    # Analyst recommendation for critical findings
    if critical:
        parts.append(
            f"\u5206\u6790\u5e08\u5efa\u8bae\uff1a{critical[0].suggestion}"
        )

    return " ".join(parts)


# ---------------------------------------------------------------------------
# TTS Provider interface
# ---------------------------------------------------------------------------

class TtsProvider(abc.ABC):
    """Abstract interface for text-to-speech providers."""

    @abc.abstractmethod
    async def synthesize(self, text: str, voice: str) -> bytes:
        """Synthesize text to MP3 bytes."""
        ...


# ---------------------------------------------------------------------------
# EdgeTtsProvider
# ---------------------------------------------------------------------------

class EdgeTtsProvider(TtsProvider):
    """Microsoft Edge TTS — free, async, outputs MP3 bytes."""

    async def synthesize(self, text: str, voice: str) -> bytes:
        from edge_tts import Communicate

        communicate = Communicate(text, voice)
        buffer = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buffer.write(chunk["data"])
        mp3_bytes = buffer.getvalue()
        logger.debug(
            "EdgeTTS synthesized %d bytes (voice=%s, text_len=%d)",
            len(mp3_bytes), voice, len(text),
        )
        return mp3_bytes


# ---------------------------------------------------------------------------
# MockTtsProvider
# ---------------------------------------------------------------------------

# Minimal valid MP3 frame (MPEG1 Layer3, 128kbps, 44100Hz, ~0.026s silence)
# This is the smallest valid MP3 that browsers can decode without error.
_SILENT_MP3 = (
    b"\xff\xfb\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
)


class MockTtsProvider(TtsProvider):
    """Returns a minimal silent MP3 — for testing without network."""

    async def synthesize(self, text: str, voice: str) -> bytes:
        logger.debug("MockTTS: returning silent MP3 (text_len=%d)", len(text))
        return _SILENT_MP3


# ---------------------------------------------------------------------------
# AudioCache — in-memory cache with TTL eviction
# ---------------------------------------------------------------------------

class AudioCache:
    """
    Thread-safe in-memory cache for generated MP3 audio.

    Each entry is keyed by a UUID hex string and auto-expires after `ttl` seconds.
    """

    def __init__(self, ttl: float = 600.0) -> None:
        self._store: dict[str, tuple[bytes, float]] = {}
        self._ttl = ttl

    def put(self, mp3_bytes: bytes) -> str:
        """Store MP3 bytes and return the audio_id (UUID hex)."""
        self._cleanup()
        audio_id = uuid.uuid4().hex
        self._store[audio_id] = (mp3_bytes, time.monotonic())
        logger.debug(
            "AudioCache: stored %d bytes as %s (entries=%d)",
            len(mp3_bytes), audio_id, len(self._store),
        )
        return audio_id

    def get(self, audio_id: str) -> bytes | None:
        """Retrieve MP3 bytes by audio_id, or None if expired/missing."""
        entry = self._store.get(audio_id)
        if entry is None:
            return None
        mp3_bytes, created_at = entry
        if time.monotonic() - created_at > self._ttl:
            del self._store[audio_id]
            return None
        return mp3_bytes

    def _cleanup(self) -> None:
        """Remove all expired entries."""
        now = time.monotonic()
        expired = [
            k for k, (_, created_at) in self._store.items()
            if now - created_at > self._ttl
        ]
        for k in expired:
            del self._store[k]

    @property
    def size(self) -> int:
        return len(self._store)
