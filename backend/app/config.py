from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite+aiosqlite:///./track_holdings.db"
    risk_free_rate: float = 0.045
    default_sigma: float = 0.30

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
