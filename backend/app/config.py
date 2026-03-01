from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite+aiosqlite:///./track_holdings.db"
    risk_free_rate: float = 0.045
    default_sigma: float = 0.30
    jwt_secret_key: str = "CHANGE-ME-IN-PRODUCTION"   # override via .env / JWT_SECRET_KEY
    jwt_expire_hours: int = 24
    cors_origins: str = "http://localhost:5173,http://localhost:3000"  # comma-separated

    # WebSocket / real-time settings
    ws_price_poll_interval: int = 5      # seconds between yfinance batch polls
    ws_price_cache_ttl: int = 30         # seconds before cached spot price expires
    ws_heartbeat_interval: int = 30      # seconds between server ping messages

    # Market Scanner settings
    scanner_poll_interval: int = 60      # seconds between scanner sweeps
    scanner_symbols: str = "SPY,QQQ,NVDA,TSLA,AAPL,MSFT,AMD,AMZN,META,GOOGL"

    # Alert engine settings
    alert_cache_refresh_interval: int = 30  # seconds between DB cache refreshes

    # NLV sampler settings
    nlv_sample_interval: int = 30  # seconds between NLV snapshots

    # AI insight settings (Phase 8a / 9a)
    ai_insight_interval: int = 120  # seconds between AI insight generation cycles
    ai_provider_type: str = "mock"  # "mock" | "claude" | "openai"
    ai_api_key: str = ""            # ANTHROPIC_API_KEY or OPENAI_API_KEY (via AI_API_KEY env var)
    ai_model: str = "claude-haiku-4-5-20251001"  # model ID for LLM provider
    ai_max_tokens: int = 600
    ai_timeout: int = 15            # seconds — httpx timeout for LLM API call

    # Macro service settings (Phase 12a)
    macro_poll_interval: int = 30             # seconds between macro ticker updates
    macro_symbols: str = "^GSPC,^VIX"        # yfinance tickers for macro tracking

    # TTS / Voice settings (Phase 10a)
    tts_enabled: bool = False              # master switch — default OFF
    tts_provider: str = "mock"             # "edge" | "mock"
    tts_voice_en: str = "en-US-AriaNeural"
    tts_voice_zh: str = "zh-CN-XiaoxiaoNeural"
    tts_cache_ttl: int = 600               # seconds before cached audio expires

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
