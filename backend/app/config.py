"""Runtime configuration (environment overridable)."""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FUZAL_", env_file=".env", extra="ignore")

    max_players: int = 5
    memory_seconds: int = 30
    puzzle_seconds: int = 180
    grid_cols: int = 4
    grid_rows: int = 4
    disconnect_grace_ms: int = 8000
    cors_origins: list[str] = ["*"]
    images_dir: Path = Path(__file__).resolve().parent.parent / "images"


settings = Settings()
