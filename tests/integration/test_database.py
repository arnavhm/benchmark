"""Integration tests for database operations."""

import pytest
from datetime import datetime, timezone
from sqlalchemy.orm import Session


def utcnow() -> datetime:
    """Return a timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


from core.database import Model, BenchmarkResult, Dataset, BenchmarkTask


@pytest.mark.integration
class TestDatabaseModels:
    """Integration tests for database ORM models."""

    def test_model_creation(self, db_session):
        """Test creating a model in the database."""
        model = Model(
            name="GPT-4o",
            provider="OpenAI",
            version="1",
            description="Latest OpenAI model",
        )

        db_session.add(model)
        db_session.commit()

        # Verify the model was created
        retrieved = db_session.query(Model).filter_by(name="GPT-4o").first()
        assert retrieved is not None
        assert retrieved.name == "GPT-4o"
        assert retrieved.provider == "OpenAI"
        assert retrieved.active == 1

    def test_model_unique_constraint(self, db_session):
        """Test that model names are unique."""
        model1 = Model(name="GPT-4o", provider="OpenAI")
        model2 = Model(name="GPT-4o", provider="OpenAI")

        db_session.add(model1)
        db_session.commit()

        db_session.add(model2)

        from sqlalchemy.exc import IntegrityError

        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_benchmark_result_creation(self, db_session):
        """Test creating a benchmark result."""
        result = BenchmarkResult(
            model_id=1,
            model_name="GPT-4o",
            accuracy=95.5,
            latency=245.3,
            cost=0.0015,
            accuracy_norm=95.5,
            latency_norm=85.2,
            cost_norm=92.1,
            final_score=90.22,
            tier="Production",
            execution_time=245.3,
            status="success",
        )

        db_session.add(result)
        db_session.commit()

        # Verify result was created
        retrieved = (
            db_session.query(BenchmarkResult).filter_by(model_name="GPT-4o").first()
        )
        assert retrieved is not None
        assert retrieved.final_score == 90.22
        assert retrieved.tier == "Production"

    def test_dataset_creation(self, db_session):
        """Test creating a dataset."""
        dataset = Dataset(
            name="benchmark_v1",
            category="general",
            domain="ai",
            description="General AI benchmark dataset v1",
            samples=100,
        )

        db_session.add(dataset)
        db_session.commit()

        # Verify dataset was created
        retrieved = db_session.query(Dataset).filter_by(name="benchmark_v1").first()
        assert retrieved is not None
        assert retrieved.samples == 100

    def test_benchmark_task_creation(self, db_session):
        """Test creating a benchmark task for tracking."""
        task = BenchmarkTask(
            task_id="celery-task-12345",
            status="running",
            model_id=1,
            dataset_id=1,
            started_at=utcnow(),
        )

        db_session.add(task)
        db_session.commit()

        # Verify task was created
        retrieved = (
            db_session.query(BenchmarkTask)
            .filter_by(task_id="celery-task-12345")
            .first()
        )
        assert retrieved is not None
        assert retrieved.status == "running"

    def test_multiple_results_per_model(self, db_session):
        """Test storing multiple results for the same model."""
        for i in range(3):
            result = BenchmarkResult(
                model_id=1,
                model_name="GPT-4o",
                accuracy=95.0 - i,
                latency=245.3 + (i * 10),
                cost=0.0015 + (i * 0.0001),
                accuracy_norm=95.0 - i,
                latency_norm=85.2 - i,
                cost_norm=92.1 - i,
                final_score=90.0 - (i * 2),
                tier="Production",
                execution_time=245.3 + (i * 10),
                status="success",
            )
            db_session.add(result)

        db_session.commit()

        # Verify all results were created
        results = db_session.query(BenchmarkResult).filter_by(model_name="GPT-4o").all()
        assert len(results) == 3

    def test_model_timestamp_tracking(self, db_session):
        """Test that created_at and updated_at are tracked."""
        model = Model(name="Claude-3.5", provider="Anthropic")

        db_session.add(model)
        db_session.commit()

        retrieved = db_session.query(Model).filter_by(name="Claude-3.5").first()

        assert retrieved.created_at is not None
        assert retrieved.updated_at is not None
        assert isinstance(retrieved.created_at, datetime)
        assert isinstance(retrieved.updated_at, datetime)


@pytest.mark.integration
class TestDatabaseQueries:
    """Integration tests for complex database queries."""

    def test_filter_results_by_tier(self, db_session):
        """Test filtering results by tier."""
        # Create multiple results with different tiers
        results_data = [
            ("GPT-4o", 90.22, "Production"),
            ("Claude-3.5", 72.58, "Analysis"),
            ("Llama-3", 89.20, "Production"),
        ]

        for model_name, score, tier in results_data:
            result = BenchmarkResult(
                model_id=1,
                model_name=model_name,
                accuracy=90.0,
                latency=250.0,
                cost=0.002,
                accuracy_norm=90.0,
                latency_norm=85.0,
                cost_norm=90.0,
                final_score=score,
                tier=tier,
                execution_time=250.0,
            )
            db_session.add(result)

        db_session.commit()

        # Query by tier
        production = (
            db_session.query(BenchmarkResult).filter_by(tier="Production").all()
        )
        assert len(production) == 2

        analysis = db_session.query(BenchmarkResult).filter_by(tier="Analysis").all()
        assert len(analysis) == 1

    def test_get_best_performing_model(self, db_session):
        """Test getting the best performing model."""
        # Create multiple results
        models_data = [
            ("GPT-4o", 90.22),
            ("Claude-3.5", 72.58),
            ("Llama-3", 89.20),
        ]

        for model_name, score in models_data:
            result = BenchmarkResult(
                model_id=1,
                model_name=model_name,
                accuracy=90.0,
                latency=250.0,
                cost=0.002,
                accuracy_norm=90.0,
                latency_norm=85.0,
                cost_norm=90.0,
                final_score=score,
                tier="Production",
                execution_time=250.0,
            )
            db_session.add(result)

        db_session.commit()

        # Get best result
        best = (
            db_session.query(BenchmarkResult)
            .order_by(BenchmarkResult.final_score.desc())
            .first()
        )

        assert best is not None
        assert best.model_name == "GPT-4o"
        assert best.final_score == 90.22

    def test_aggregate_statistics(self, db_session):
        """Test computing aggregate statistics."""
        from sqlalchemy import func

        # Create multiple results
        for i in range(5):
            result = BenchmarkResult(
                model_id=1,
                model_name=f"Model-{i}",
                accuracy=90.0 - (i * 5),
                latency=250.0 + (i * 50),
                cost=0.002 + (i * 0.0001),
                accuracy_norm=90.0 - (i * 5),
                latency_norm=85.0 - (i * 3),
                cost_norm=90.0 - (i * 5),
                final_score=80.0 - (i * 5),
                tier="Production",
                execution_time=250.0,
            )
            db_session.add(result)

        db_session.commit()

        # Compute aggregate stats
        stmt = db_session.query(
            func.count(BenchmarkResult.id).label("total"),
            func.avg(BenchmarkResult.final_score).label("avg_score"),
            func.max(BenchmarkResult.final_score).label("max_score"),
            func.min(BenchmarkResult.final_score).label("min_score"),
        )

        stats = stmt.first()

        assert stats.total == 5
        assert stats.avg_score < 80.0
        assert stats.max_score == 80.0
        assert stats.min_score < 80.0


@pytest.mark.integration
class TestDatabaseIndexes:
    """Integration tests for database indexes and performance."""

    def test_model_provider_index(self, db_session):
        """Test that provider index improves query performance."""
        # Create multiple models with different providers
        for i in range(10):
            model = Model(
                name=f"Model-{i}", provider="OpenAI" if i % 2 == 0 else "Anthropic"
            )
            db_session.add(model)

        db_session.commit()

        # Query by provider
        openai_models = db_session.query(Model).filter_by(provider="OpenAI").all()
        assert len(openai_models) == 5

        anthropic_models = db_session.query(Model).filter_by(provider="Anthropic").all()
        assert len(anthropic_models) == 5

    def test_score_created_at_index(self, db_session):
        """Test that score and created_at indexes work together."""
        # Create results with different scores
        for i in range(10):
            result = BenchmarkResult(
                model_id=1,
                model_name=f"Model-{i}",
                accuracy=90.0,
                latency=250.0,
                cost=0.002,
                accuracy_norm=90.0,
                latency_norm=85.0,
                cost_norm=90.0,
                final_score=80.0 + (i * 2),
                tier="Production",
                execution_time=250.0,
            )
            db_session.add(result)

        db_session.commit()

        # Query with combined filters
        top_results = (
            db_session.query(BenchmarkResult)
            .filter(BenchmarkResult.final_score > 85.0)
            .order_by(BenchmarkResult.created_at.desc())
            .all()
        )

        assert len(top_results) > 0
