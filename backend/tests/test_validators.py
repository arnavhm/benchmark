"""
Unit tests for core.validators module.
"""

import pytest
from datetime import datetime
from pydantic import ValidationError

from core.validators import (
    BenchmarkMetrics,
    BenchmarkResultCreate,
    ModelCreate,
    DatasetCreate,
    TierEnum,
    BenchmarkRequest,
    AggregateStats,
)


@pytest.mark.unit
class TestBenchmarkMetrics:
    """Tests for BenchmarkMetrics validator."""

    def test_valid_metrics(self):
        """Test valid metric values."""
        metrics = BenchmarkMetrics(accuracy=95.5, latency=245.3, cost=0.0015)

        assert metrics.accuracy == 95.5
        assert metrics.latency == 245.3
        assert metrics.cost == 0.0015

    def test_accuracy_validation_bounds(self):
        """Test accuracy bounds validation."""
        # Valid: 0-100
        assert BenchmarkMetrics(accuracy=0.0, latency=1.0, cost=0.1).accuracy == 0.0
        assert BenchmarkMetrics(accuracy=100.0, latency=1.0, cost=0.1).accuracy == 100.0

        # Invalid: > 100
        with pytest.raises(ValidationError):
            BenchmarkMetrics(accuracy=105.0, latency=1.0, cost=0.1)

        # Invalid: < 0
        with pytest.raises(ValidationError):
            BenchmarkMetrics(accuracy=-5.0, latency=1.0, cost=0.1)

    def test_latency_non_negative(self):
        """Test that latency cannot be negative."""
        with pytest.raises(ValidationError):
            BenchmarkMetrics(accuracy=95.0, latency=-1.0, cost=0.1)

        # Zero should be valid
        assert BenchmarkMetrics(accuracy=95.0, latency=0.0, cost=0.1).latency == 0.0

    def test_cost_non_negative(self):
        """Test that cost cannot be negative."""
        with pytest.raises(ValidationError):
            BenchmarkMetrics(accuracy=95.0, latency=100.0, cost=-0.01)

        # Zero should be valid
        assert BenchmarkMetrics(accuracy=95.0, latency=100.0, cost=0.0).cost == 0.0

    def test_accuracy_rounding(self):
        """Test that accuracy is rounded to 2 decimal places."""
        metrics = BenchmarkMetrics(accuracy=95.5555, latency=1.0, cost=0.1)
        assert metrics.accuracy == 95.56


@pytest.mark.unit
class TestBenchmarkResultCreate:
    """Tests for BenchmarkResultCreate validator."""

    def test_valid_result(self, sample_benchmark_data):
        """Test creating valid benchmark result."""
        result = BenchmarkResultCreate(**sample_benchmark_data)

        assert result.model_name == "GPT-4o"
        assert result.final_score == 90.22
        assert result.tier == TierEnum.PRODUCTION
        assert result.status == "success"

    def test_result_with_invalid_tier(self, sample_benchmark_data):
        """Test that invalid tier is rejected."""
        sample_benchmark_data["tier"] = "InvalidTier"

        with pytest.raises(ValidationError):
            BenchmarkResultCreate(**sample_benchmark_data)

    def test_result_with_failed_status(self, sample_benchmark_data):
        """Test result with failed status."""
        sample_benchmark_data["status"] = "failed"
        sample_benchmark_data["error_message"] = "API timeout"

        result = BenchmarkResultCreate(**sample_benchmark_data)
        assert result.status == "failed"
        assert result.error_message == "API timeout"

    def test_result_score_bounds(self):
        """Test that final score must be 0-100."""
        valid_data = {
            "model_name": "Test",
            "accuracy": 95.5,
            "latency": 245.3,
            "cost": 0.0015,
            "accuracy_norm": 95.5,
            "latency_norm": 85.2,
            "cost_norm": 92.1,
            "final_score": 90.22,
            "tier": TierEnum.PRODUCTION,
            "execution_time": 245.3,
        }

        # Valid score
        result = BenchmarkResultCreate(**valid_data)
        assert result.final_score == 90.22

        # Invalid: > 100
        valid_data["final_score"] = 105.0
        with pytest.raises(ValidationError):
            BenchmarkResultCreate(**valid_data)


@pytest.mark.unit
class TestModelCreate:
    """Tests for ModelCreate validator."""

    def test_valid_model(self, sample_model_data):
        """Test creating valid model."""
        model = ModelCreate(**sample_model_data)

        assert model.name == "GPT-4o"
        assert model.provider == "OpenAI"

    def test_model_name_required(self, sample_model_data):
        """Test that model name is required."""
        del sample_model_data["name"]

        with pytest.raises(ValidationError):
            ModelCreate(**sample_model_data)

    def test_model_name_length(self, sample_model_data):
        """Test model name length validation."""
        # Empty name
        sample_model_data["name"] = ""
        with pytest.raises(ValidationError):
            ModelCreate(**sample_model_data)

        # Too long (> 255)
        sample_model_data["name"] = "a" * 256
        with pytest.raises(ValidationError):
            ModelCreate(**sample_model_data)

    def test_model_provider_required(self, sample_model_data):
        """Test that provider is required."""
        del sample_model_data["provider"]

        with pytest.raises(ValidationError):
            ModelCreate(**sample_model_data)


@pytest.mark.unit
class TestDatasetCreate:
    """Tests for DatasetCreate validator."""

    def test_valid_dataset(self, sample_dataset_data):
        """Test creating valid dataset."""
        dataset = DatasetCreate(**sample_dataset_data)

        assert dataset.name == "benchmark_v1"
        assert dataset.category == "general"
        assert dataset.domain == "ai"

    def test_dataset_samples_non_negative(self, sample_dataset_data):
        """Test that samples must be non-negative."""
        sample_dataset_data["samples"] = -1

        with pytest.raises(ValidationError):
            DatasetCreate(**sample_dataset_data)

    def test_dataset_required_fields(self, sample_dataset_data):
        """Test required fields."""
        # Missing name
        data = sample_dataset_data.copy()
        del data["name"]
        with pytest.raises(ValidationError):
            DatasetCreate(**data)

        # Missing category
        data = sample_dataset_data.copy()
        del data["category"]
        with pytest.raises(ValidationError):
            DatasetCreate(**data)


@pytest.mark.unit
class TestBenchmarkRequest:
    """Tests for BenchmarkRequest validator."""

    def test_valid_request(self):
        """Test valid benchmark request."""
        request = BenchmarkRequest(model_names=["GPT-4o", "Claude-3.5"])

        assert len(request.model_names) == 2
        assert "GPT-4o" in request.model_names

    def test_request_requires_models(self):
        """Test that at least one model is required."""
        with pytest.raises(ValidationError):
            BenchmarkRequest(model_names=[])

    def test_request_max_models(self):
        """Test maximum number of models."""
        models = [f"model_{i}" for i in range(101)]

        with pytest.raises(ValidationError):
            BenchmarkRequest(model_names=models)

    def test_request_with_timeout(self):
        """Test request with custom timeout."""
        request = BenchmarkRequest(model_names=["GPT-4o"], timeout=600)
        assert request.timeout == 600


@pytest.mark.unit
class TestAggregateStats:
    """Tests for AggregateStats validator."""

    def test_valid_stats(self):
        """Test valid aggregate statistics."""
        stats = AggregateStats(
            total_benchmarks=100,
            avg_score=82.5,
            best_score=95.0,
            worst_score=45.0,
            production_count=50,
            analysis_count=35,
            research_count=15,
            avg_accuracy=90.0,
            avg_latency=250.0,
            avg_cost=0.002,
        )

        assert stats.total_benchmarks == 100
        assert stats.avg_score == 82.5

    def test_stats_score_bounds(self):
        """Test that scores are within bounds."""
        # avg_score > 100
        with pytest.raises(ValidationError):
            AggregateStats(
                total_benchmarks=1,
                avg_score=105.0,
                best_score=90.0,
                worst_score=80.0,
                production_count=0,
                analysis_count=1,
                research_count=0,
                avg_accuracy=90.0,
                avg_latency=250.0,
                avg_cost=0.002,
            )

    def test_stats_non_negative_counts(self):
        """Test that counts cannot be negative."""
        with pytest.raises(ValidationError):
            AggregateStats(
                total_benchmarks=-1,
                avg_score=82.5,
                best_score=95.0,
                worst_score=45.0,
                production_count=50,
                analysis_count=35,
                research_count=15,
                avg_accuracy=90.0,
                avg_latency=250.0,
                avg_cost=0.002,
            )


@pytest.mark.unit
class TestTierEnum:
    """Tests for TierEnum."""

    def test_tier_values(self):
        """Test tier enum values."""
        assert TierEnum.PRODUCTION.value == "Production"
        assert TierEnum.ANALYSIS.value == "Analysis"
        assert TierEnum.RESEARCH.value == "Research"

    def test_tier_string_conversion(self):
        """Test converting tier to string."""
        assert str(TierEnum.PRODUCTION) == "TierEnum.PRODUCTION"
        assert TierEnum.PRODUCTION.value == "Production"
