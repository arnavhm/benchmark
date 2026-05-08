"""
LLM Scoring Engine

This module calculates comprehensive LLM performance scores based on
accuracy, latency, and cost metrics.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
import json


@dataclass
class Metrics:
    """Data class for LLM performance metrics."""

    accuracy: float  # 0-100
    latency: float  # milliseconds
    cost: float  # dollars per 1K tokens


class ScoringEngine:
    """Calculates LLM performance scores based on multiple metrics."""

    # Weighting factors for metrics (should sum to 1.0)
    DEFAULT_WEIGHTS = {"accuracy": 0.5, "latency": 0.3, "cost": 0.2}

    # Benchmark ranges for normalization
    BENCHMARK_RANGES = {
        "accuracy": {"min": 50, "max": 100},  # 50-100%
        "latency": {"min": 100, "max": 5000},  # 100-5000ms
        "cost": {"min": 0.001, "max": 0.05},  # $0.001-$0.05 per 1K tokens
    }

    def __init__(
        self, weights: Optional[Dict[str, float]] = None, normalize: bool = True
    ):
        """
        Initialize the scoring engine.

        Args:
            weights: Custom weighting for metrics (default: equal emphasis)
            normalize: Whether to normalize scores to 0-100 range
        """
        self.weights = weights or self.DEFAULT_WEIGHTS
        self.normalize = normalize

        # Validate weights
        if abs(sum(self.weights.values()) - 1.0) > 0.01:
            raise ValueError("Weights must sum to approximately 1.0")

    def normalize_metric(self, metric: str, value: float) -> float:
        """
        Normalize a metric to 0-100 scale.

        Args:
            metric: Metric name (accuracy, latency, cost)
            value: Metric value

        Returns:
            Normalized value (0-100)
        """
        if metric not in self.BENCHMARK_RANGES:
            return value

        benchmark = self.BENCHMARK_RANGES[metric]
        min_val = benchmark["min"]
        max_val = benchmark["max"]

        # Clamp value within range
        value = max(min_val, min(max_val, value))

        if metric == "accuracy":
            # For accuracy, higher is better
            normalized = ((value - min_val) / (max_val - min_val)) * 100
        else:
            # For latency and cost, lower is better (invert)
            normalized = ((max_val - value) / (max_val - min_val)) * 100

        return max(0, min(100, normalized))

    def calculate_score(
        self, accuracy: float, latency: float, cost: float
    ) -> float:
        """
        Calculate composite LLM score.

        Args:
            accuracy: Accuracy percentage (0-100)
            latency: Response time in milliseconds
            cost: Cost per 1K tokens in dollars

        Returns:
            Composite score (0-100)
        """
        # Normalize individual metrics
        norm_accuracy = (
            self.normalize_metric("accuracy", accuracy) if self.normalize else accuracy
        )
        norm_latency = (
            self.normalize_metric("latency", latency) if self.normalize else latency
        )
        norm_cost = (
            self.normalize_metric("cost", cost) if self.normalize else cost
        )

        # Calculate weighted composite score
        score = (
            norm_accuracy * self.weights["accuracy"]
            + norm_latency * self.weights["latency"]
            + norm_cost * self.weights["cost"]
        )

        return round(score, 2)

    def calculate_scores(
        self, models: List[Dict[str, float]]
    ) -> List[Dict[str, float]]:
        """
        Calculate scores for multiple models.

        Args:
            models: List of dicts with 'name', 'accuracy', 'latency', 'cost'

        Returns:
            List of dicts with model scores
        """
        results = []
        for model in models:
            score = self.calculate_score(
                model["accuracy"], model["latency"], model["cost"]
            )
            results.append({**model, "score": score})

        # Sort by score (descending)
        results.sort(key=lambda x: x["score"], reverse=True)
        return results

    def generate_report(self, models: List[Dict[str, float]]) -> str:
        """
        Generate a formatted performance report.

        Args:
            models: List of model metrics

        Returns:
            Formatted report string
        """
        scored_models = self.calculate_scores(models)

        report = "LLM Benchmark Results\n"
        report += "=" * 60 + "\n\n"

        for idx, model in enumerate(scored_models, 1):
            report += f"{idx}. {model['name']}\n"
            report += f"   Accuracy:  {model['accuracy']:.1f}%\n"
            report += f"   Latency:   {model['latency']:.0f}ms\n"
            report += f"   Cost:      ${model['cost']:.4f}\n"
            report += f"   Score:     {model['score']:.2f}/100\n\n"

        return report


if __name__ == "__main__":
    # Example usage
    engine = ScoringEngine()

    test_models = [
        {"name": "GPT-4", "accuracy": 92, "latency": 850, "cost": 0.03},
        {"name": "Claude 3", "accuracy": 90, "latency": 720, "cost": 0.025},
        {"name": "Llama 2", "accuracy": 78, "latency": 450, "cost": 0.005},
    ]

    scores = engine.calculate_scores(test_models)
    print(engine.generate_report(test_models))
