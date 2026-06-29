"""
Structured logging configuration with structlog.
Provides JSON or text formatted logging.
"""

import logging
import os
from logging.handlers import RotatingFileHandler
import structlog

from core.config import settings

# Create logs directory if it doesn't exist
if settings.logging.file_path:
    os.makedirs(os.path.dirname(settings.logging.file_path), exist_ok=True)


def configure_logging():
    """Configure structlog and standard logging."""

    # Standard logging configuration
    log_level = getattr(logging, settings.logging.level)

    # Root logger setup
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Clear existing handlers
    root_logger.handlers.clear()

    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(log_level)

    # File handler with rotation
    if settings.logging.file_path:
        file_handler = RotatingFileHandler(
            settings.logging.file_path,
            maxBytes=10_000_000,  # 10MB
            backupCount=10,
        )
        file_handler.setLevel(log_level)
        root_logger.addHandler(file_handler)

    root_logger.addHandler(console_handler)

    # Configure structlog
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.processors.JSONRenderer()
            if settings.logging.format == "json"
            else structlog.dev.ConsoleRenderer(),
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str):
    """Get a logger instance."""
    return structlog.get_logger(name)


# Initialize logging on module import
configure_logging()

if __name__ == "__main__":
    logger = get_logger(__name__)
    logger.info("Logging configured", environment=settings.environment)
