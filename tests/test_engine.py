"""
Unit tests for core.engine module.
"""

import pytest
from core.engine import BenchmarkEngine
from core.validators import TierEnum


@pytest.mark.unit
class TestBenchmarkEngine:
    """Tests for the benchmark scoring engine."""

    def test_calculate_score_perfect(self):
        """Test score calculation with perfect metrics."""
        engine = BenchmarkEngine()

        # Perfect: 100% accuracy, 0ms latency, $0 cost
        score = engine.calculate_score(accuracy=100.0, latency=0.0, cost=0.0)

        assert score == 100.0
        assert isinstance(score, float)

    def test_calculate_score_realistic(self):
        """Test score calculation with realistic metrics."""
        engine = BenchmarkEngine()

        # Realistic metrics: 95% accuracy, 245ms latency, $0.0015 cost
        score = engine.calculate_score(accuracy=95.5, latency=245.3, cost=0.0015)

        # Should be approximately 90.22 based on weighted formula
        assert 88.0 <= score <= 92.0
        assert isinstance(score, float)

    def test_calculate_score_low(self):
        """Test score calculation with poor metrics."""
        engine = BenchmarkEngine()

        # Poor: 50% accuracy, 5000ms latency, $10 cost
        score = engine.calculate_score(accuracy=50.0, latency=5000.0, cost=10.0)

        assert score < 50.0
        assert isinstance(score, float)

    def test_calculate_score_normalized(self):
        """Test that individual metric normalization works."""
        engine = BenchmarkEngine()

        # Test normalized components
        acc_norm = engine.normalize_accuracy(accuracy=95.5)
        assert 0 <= acc_norm <= 100

        lat_norm = engine.normalize_latency(latency=245.3)
        assert 0 <= lat_norm <= 100

        cost_norm = engine.normalize_cost(cost=0.0015)
        assert 0 <= cost_norm <= 100

    def test_determine_tier_production(self):
        """Test tier determination for Production tier."""
        engine = BenchmarkEngine()

        # Production: score > 85
        tier = engine.determine_tier(score=90.22)
        assert tier == TierEnum.PRODUCTION

    def test_determine_tier_analysis(self):
        """Test tier determination for Analysis tier."""
        engine = BenchmarkEngine()

        # Analysis: 70 < score <= 85
        tier = engine.determine_tier(score=77.5)
        assert tier == TierEnum.ANALYSIS

    def test_determine_tier_research(self):
        """Test tier determination for Research tier."""
        engine = BenchmarkEngine()

        # Research: score <= 70
        tier = engine.determine_tier(score=65.0)
        assert tier == TierEnum.RESEARCH

    def test_determine_tier_boundaries(self):
        """Test tier boundaries."""
        engine = BenchmarkEngine()

        # Boundary tests
        assert engine.determine_tier(score=85.0) == TierEnum.ANALYSIS
        assert engine.determine_tier(score=85.1) == TierEnum.PRODUCTION
        assert engine.determine_tier(score=70.0) == TierEnum.RESEARCH
        assert engine.determine_tier(score=70.1) == TierEnum.ANALYSIS

    def test_score_range_bounds(self):
        """Test that scores stay within valid range."""
        engine = BenchmarkEngine()

        # Test various input combinations
        test_cases = [
            (0.0, 10000.0, 100.0),  # Worst case
            (100.0, 0.0, 0.0),  # Best case
            (50.0, 1000.0, 1.0),  # Middle case
        ]

        for accuracy, latency, cost in test_cases:
            score = engine.calculate_score(
                accuracy=accuracy, latency=latency, cost=cost
            )
            assert 0 <= score <= 100, (
                f"Score {score} out of bounds for inputs ({accuracy}, {latency}, {cost})"
            )

    def test_calculate_score_with_invalid_accuracy(self):
        """Test that invalid accuracy raises error."""
        engine = BenchmarkEngine()

        with pytest.raises(ValueError):
            engine.calculate_score(accuracy=105.0, latency=100.0, cost=0.1)

    def test_calculate_score_with_negative_latency(self):
        """Test that negative latency raises error."""
        engine = BenchmarkEngine()

        with pytest.raises(ValueError):
            engine.calculate_score(accuracy=95.0, latency=-100.0, cost=0.1)

    def test_calculate_score_with_negative_cost(self):
        """Test that negative cost raises error."""
        engine = BenchmarkEngine()

        with pytest.raises(ValueError):
            engine.calculate_score(accuracy=95.0, latency=100.0, cost=-0.1)


@pytest.mark.unit
class TestBenchmarkEngineWeights:
    """Test weighted formula application."""

    def test_weighted_formula_weights_accuracy(self):
        """Test that accuracy has 50% weight."""
        engine = BenchmarkEngine()

        # 100% accuracy should contribute 50 to final score
        score = engine.calculate_score(accuracy=100.0, latency=10000.0, cost=100.0)
        # With worst latency and cost, accuracy should dominate
        assert score > 40.0  # Accuracy contributes ~50%

    def test_weighted_formula_weights_latency(self):
        """Test that latency has 30% weight."""
        engine = BenchmarkEngine()

        # 100% latency score (0ms) should contribute 30 to final score
        score = engine.calculate_score(accuracy=0.0, latency=0.0, cost=100.0)
        # With worst accuracy but best latency
        assert score > 15.0  # Latency contributes ~30%

    def test_weighted_formula_weights_cost(self):
        """Test that cost has 20% weight."""
        engine = BenchmarkEngine()

        # 100% cost score ($0) should contribute 20 to final score
        score = engine.calculate_score(accuracy=0.0, latency=10000.0, cost=0.0)
        # With worst accuracy and latency but best cost
        assert score > 10.0  # Cost contributes ~20%
