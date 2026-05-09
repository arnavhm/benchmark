"""
Configuration management using Pydantic v2.
Environment-based settings with validation.
"""

from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class DatabaseSettings(BaseSettings):
    """Database configuration."""

    url: str = Field(
        default="postgresql://benchmark_user:benchmark_pass@localhost:5432/benchmark_db",
        description="PostgreSQL connection URL",
    )
    echo: bool = Field(default=False, description="Log SQL statements")
    pool_size: int = Field(default=10, description="Connection pool size")
    max_overflow: int = Field(default=20, description="Maximum overflow connections")

    model_config = SettingsConfigDict(env_prefix="DB_")


class CacheSettings(BaseSettings):
    """Redis cache configuration."""

    url: str = Field(
        default="redis://localhost:6379/0", description="Redis connection URL"
    )
    ttl: int = Field(default=3600, description="Cache time-to-live in seconds")
    enabled: bool = Field(default=True, description="Enable caching")

    model_config = SettingsConfigDict(env_prefix="CACHE_")


class APISettings(BaseSettings):
    """API configuration."""

    host: str = Field(default="0.0.0.0", description="API host")
    port: int = Field(default=5002, description="API port")
    debug: bool = Field(default=False, description="Debug mode")
    version: str = Field(default="1.0.0", description="API version")

    model_config = SettingsConfigDict(env_prefix="API_")


class LoggingSettings(BaseSettings):
    """Logging configuration."""

    level: str = Field(default="INFO", description="Logging level")
    format: str = Field(default="json", description="Logging format (json or text)")
    file_path: Optional[str] = Field(
        default="logs/app.log", description="Log file path"
    )

    model_config = SettingsConfigDict(env_prefix="LOG_")

    @field_validator("level")
    def validate_level(cls, v):
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        if v not in valid_levels:
            raise ValueError(f"Log level must be one of {valid_levels}")
        return v


class BenchmarkSettings(BaseSettings):
    """Benchmark-specific settings."""

    timeout: int = Field(default=300, description="Benchmark timeout in seconds")
    max_parallel: int = Field(default=10, description="Maximum parallel API calls")
    retry_attempts: int = Field(
        default=3, description="Retry attempts for failed calls"
    )
    retry_delay: float = Field(default=1.0, description="Retry delay in seconds")

    model_config = SettingsConfigDict(env_prefix="BENCHMARK_")


class Settings(BaseSettings):
    """Main settings class combining all configurations."""

    # Application settings
    app_name: str = Field(default="LLM Benchmark", description="Application name")
    environment: str = Field(
        default="development",
        description="Environment (development, staging, production)",
    )

    # Sub-settings
    database: DatabaseSettings = Field(default_factory=DatabaseSettings)
    cache: CacheSettings = Field(default_factory=CacheSettings)
    api: APISettings = Field(default_factory=APISettings)
    logging: LoggingSettings = Field(default_factory=LoggingSettings)
    benchmark: BenchmarkSettings = Field(default_factory=BenchmarkSettings)

    model_config = SettingsConfigDict(
        case_sensitive=True,
        env_file=".env",
        env_file_encoding="utf-8",
    )

    @field_validator("environment")
    def validate_environment(cls, v):
        valid_envs = ["development", "staging", "production"]
        if v not in valid_envs:
            raise ValueError(f"Environment must be one of {valid_envs}")
        return v


def get_settings() -> Settings:
    """Get application settings from environment."""
    return Settings()


# Export settings instance
settings = get_settings()


if __name__ == "__main__":
    # Print all settings for debugging
    import json

    print(json.dumps(settings.model_dump(), indent=2, default=str))
