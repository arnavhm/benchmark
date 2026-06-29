"""
Test configuration and fixtures.
"""

import pytest
import os
from typing import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

# Set test environment
os.environ["ENVIRONMENT"] = "testing"
os.environ["DB_URL"] = "sqlite:///:memory:"

from core.database import Base, get_db
from core.config import settings


@pytest.fixture(scope="session")
def db_engine():
    """Create test database engine."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def db_session(db_engine) -> Generator[Session, None, None]:
    """Provide database session for tests."""
    connection = db_engine.connect()
    transaction = connection.begin()
    session = sessionmaker(autocommit=False, autoflush=False, bind=connection)()

    yield session

    session.close()
    if transaction.is_active:
        transaction.rollback()
    connection.close()


@pytest.fixture(scope="function")
def client(db_session):
    """Provide test client with database session."""
    # This will be used for API tests
    pass


@pytest.fixture
def sample_model_data():
    """Sample model data for testing."""
    return {
        "name": "GPT-4o",
        "provider": "OpenAI",
        "version": "1",
        "description": "Latest OpenAI model",
    }


@pytest.fixture
def sample_benchmark_data():
    """Sample benchmark result data."""
    return {
        "model_name": "GPT-4o",
        "accuracy": 95.5,
        "latency": 245.3,
        "cost": 0.0015,
        "accuracy_norm": 95.5,
        "latency_norm": 85.2,
        "cost_norm": 92.1,
        "final_score": 90.22,
        "tier": "Production",
        "execution_time": 245.3,
        "status": "success",
    }


@pytest.fixture
def sample_dataset_data():
    """Sample dataset data."""
    return {
        "name": "benchmark_v1",
        "category": "general",
        "domain": "ai",
        "description": "General AI benchmark dataset v1",
        "samples": 100,
    }


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line("markers", "unit: Unit tests")
    config.addinivalue_line("markers", "integration: Integration tests")
    config.addinivalue_line("markers", "e2e: End-to-end tests")
    config.addinivalue_line("markers", "slow: Slow tests")
