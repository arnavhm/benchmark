"""
Database setup with SQLAlchemy ORM.
Includes connection pooling, session factory, and base model.
"""

from typing import Generator
from datetime import datetime, timezone
from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    Float,
    DateTime,
    Text,
    Index,
)
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from sqlalchemy.pool import QueuePool
import logging

from core.config import settings

logger = logging.getLogger(__name__)


def utcnow() -> datetime:
    """Return a timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


# Create database engine with connection pooling
engine = create_engine(
    settings.database.url,
    echo=settings.database.echo,
    poolclass=QueuePool,
    pool_size=settings.database.pool_size,
    max_overflow=settings.database.max_overflow,
    pool_pre_ping=True,  # Verify connection health before using
)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for ORM models
Base = declarative_base()


class Model(Base):
    """ORM model for LLM models being benchmarked."""

    __tablename__ = "models"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False, index=True)
    provider = Column(
        String(100), nullable=False
    )  # e.g., "OpenAI", "Anthropic", "Meta"
    version = Column(String(50), nullable=True)
    description = Column(Text, nullable=True)
    active = Column(Integer, default=1)  # Boolean as integer for compatibility
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (Index("idx_provider_active", "provider", "active"),)

    def __repr__(self):
        return f"<Model(id={self.id}, name={self.name}, provider={self.provider})>"


class BenchmarkResult(Base):
    """ORM model for benchmark results."""

    __tablename__ = "benchmark_results"

    id = Column(Integer, primary_key=True, index=True)
    model_id = Column(Integer, nullable=False, index=True)
    model_name = Column(String(255), nullable=False, index=True)
    dataset_id = Column(Integer, nullable=True)

    # Metrics
    accuracy = Column(Float, nullable=False)
    latency = Column(Float, nullable=False)  # milliseconds
    cost = Column(Float, nullable=False)  # dollars

    # Calculated scores
    accuracy_norm = Column(Float, nullable=False)  # Normalized 0-100
    latency_norm = Column(Float, nullable=False)
    cost_norm = Column(Float, nullable=False)
    final_score = Column(Float, nullable=False, index=True)  # Weighted score

    # Tier classification
    tier = Column(
        String(50), nullable=False, index=True
    )  # Production/Analysis/Research

    # Raw response data
    model_response = Column(Text, nullable=True)  # JSON stringified response

    # Metadata
    execution_time = Column(Float, nullable=False)  # milliseconds
    error_message = Column(Text, nullable=True)
    status = Column(String(50), default="success")  # success, failed, timeout

    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        Index("idx_model_tier", "model_name", "tier"),
        Index("idx_score_created", "final_score", "created_at"),
    )

    def __repr__(self):
        return f"<BenchmarkResult(id={self.id}, model={self.model_name}, score={self.final_score}, tier={self.tier})>"


class Dataset(Base):
    """ORM model for benchmark datasets."""

    __tablename__ = "datasets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=False)
    domain = Column(String(100), nullable=False)
    samples = Column(Integer, default=0)

    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (Index("idx_category_domain", "category", "domain"),)

    def __repr__(self):
        return f"<Dataset(id={self.id}, name={self.name}, category={self.category})>"


class BenchmarkTask(Base):
    """ORM model for tracking benchmark execution tasks."""

    __tablename__ = "benchmark_tasks"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(
        String(255), unique=True, nullable=False, index=True
    )  # Celery task ID
    status = Column(
        String(50), default="pending"
    )  # pending, running, completed, failed

    model_id = Column(Integer, nullable=False)
    dataset_id = Column(Integer, nullable=False)

    # Progress tracking
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (Index("idx_status_created", "status", "created_at"),)

    def __repr__(self):
        return f"<BenchmarkTask(id={self.id}, status={self.status}, model_id={self.model_id})>"


def get_db() -> Generator[Session, None, None]:
    """Dependency injection for database sessions."""
    db = SessionLocal()
    try:
        yield db
    except Exception as e:
        logger.error(f"Database error: {e}")
        db.rollback()
        raise
    finally:
        db.close()


def init_db():
    """Initialize database tables."""
    logger.info("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created successfully")


def drop_db():
    """Drop all database tables (for testing)."""
    logger.warning("Dropping all database tables...")
    Base.metadata.drop_all(bind=engine)
    logger.warning("Database tables dropped")


if __name__ == "__main__":
    # Initialize logging
    logging.basicConfig(level=logging.INFO)

    # Create tables
    init_db()
