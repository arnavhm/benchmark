"""
Data quality validation using Great Expectations patterns.
Ensures benchmark data integrity and consistency.
"""

from typing import Dict, List, Tuple
from dataclasses import dataclass
from datetime import datetime, timezone

from core.logger import get_logger

logger = get_logger(__name__)


def utcnow() -> datetime:
    """Return a timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


@dataclass
class ValidationResult:
    """Result of a data quality check."""

    passed: bool
    check_name: str
    message: str
    details: Dict = None


class BenchmarkDataValidator:
    """Validates benchmark data quality."""

    # Score range validation
    MIN_SCORE = 0.0
    MAX_SCORE = 100.0

    # Metric thresholds
    MIN_ACCURACY = 0.0
    MAX_ACCURACY = 100.0
    MIN_LATENCY = 0.0  # milliseconds
    MAX_LATENCY = 3600000.0  # 1 hour
    MIN_COST = 0.0  # dollars
    MAX_COST = 1000.0  # dollars

    # Valid tier values
    VALID_TIERS = {"Production", "Analysis", "Research"}

    # Valid statuses
    VALID_STATUSES = {"success", "failed", "timeout", "partial"}

    def validate_accuracy(self, accuracy: float) -> ValidationResult:
        """Validate accuracy value."""
        if accuracy < self.MIN_ACCURACY or accuracy > self.MAX_ACCURACY:
            return ValidationResult(
                passed=False,
                check_name="accuracy_bounds",
                message=f"Accuracy {accuracy} outside bounds [{self.MIN_ACCURACY}, {self.MAX_ACCURACY}]",
            )
        return ValidationResult(
            passed=True,
            check_name="accuracy_bounds",
            message="Accuracy within valid range",
        )

    def validate_latency(self, latency: float) -> ValidationResult:
        """Validate latency value."""
        if latency < self.MIN_LATENCY or latency > self.MAX_LATENCY:
            return ValidationResult(
                passed=False,
                check_name="latency_bounds",
                message=f"Latency {latency}ms outside bounds [{self.MIN_LATENCY}, {self.MAX_LATENCY}]",
            )
        return ValidationResult(
            passed=True,
            check_name="latency_bounds",
            message="Latency within valid range",
        )

    def validate_cost(self, cost: float) -> ValidationResult:
        """Validate cost value."""
        if cost < self.MIN_COST or cost > self.MAX_COST:
            return ValidationResult(
                passed=False,
                check_name="cost_bounds",
                message=f"Cost ${cost} outside bounds [${self.MIN_COST}, ${self.MAX_COST}]",
            )
        return ValidationResult(
            passed=True,
            check_name="cost_bounds",
            message="Cost within valid range",
        )

    def validate_score(self, score: float) -> ValidationResult:
        """Validate final score."""
        if score < self.MIN_SCORE or score > self.MAX_SCORE:
            return ValidationResult(
                passed=False,
                check_name="score_bounds",
                message=f"Score {score} outside bounds [{self.MIN_SCORE}, {self.MAX_SCORE}]",
            )
        return ValidationResult(
            passed=True,
            check_name="score_bounds",
            message="Score within valid range",
        )

    def validate_tier(self, tier: str) -> ValidationResult:
        """Validate deployment tier."""
        if tier not in self.VALID_TIERS:
            return ValidationResult(
                passed=False,
                check_name="tier_validity",
                message=f"Tier '{tier}' not in {self.VALID_TIERS}",
            )
        return ValidationResult(
            passed=True,
            check_name="tier_validity",
            message=f"Tier '{tier}' is valid",
        )

    def validate_status(self, status: str) -> ValidationResult:
        """Validate result status."""
        if status not in self.VALID_STATUSES:
            return ValidationResult(
                passed=False,
                check_name="status_validity",
                message=f"Status '{status}' not in {self.VALID_STATUSES}",
            )
        return ValidationResult(
            passed=True,
            check_name="status_validity",
            message=f"Status '{status}' is valid",
        )

    def validate_model_name(self, model_name: str) -> ValidationResult:
        """Validate model name."""
        if not model_name or len(model_name) == 0:
            return ValidationResult(
                passed=False,
                check_name="model_name_required",
                message="Model name is required",
            )

        if len(model_name) > 255:
            return ValidationResult(
                passed=False,
                check_name="model_name_length",
                message=f"Model name too long ({len(model_name)} > 255)",
            )

        return ValidationResult(
            passed=True,
            check_name="model_name_validity",
            message="Model name is valid",
        )

    def validate_result_consistency(
        self,
        accuracy: float,
        latency: float,
        cost: float,
        score: float,
        tier: str,
    ) -> List[ValidationResult]:
        """
        Validate overall consistency of a result.

        Returns:
            List of validation results
        """
        results = []

        # Basic validation
        results.append(self.validate_accuracy(accuracy))
        results.append(self.validate_latency(latency))
        results.append(self.validate_cost(cost))
        results.append(self.validate_score(score))
        results.append(self.validate_tier(tier))

        # Logical consistency: tier should match score range
        if score > 85 and tier != "Production":
            results.append(
                ValidationResult(
                    passed=False,
                    check_name="score_tier_consistency",
                    message=f"Score {score} suggests Production tier, but got {tier}",
                )
            )
        elif 70 < score <= 85 and tier != "Analysis":
            results.append(
                ValidationResult(
                    passed=False,
                    check_name="score_tier_consistency",
                    message=f"Score {score} suggests Analysis tier, but got {tier}",
                )
            )
        elif score <= 70 and tier != "Research":
            results.append(
                ValidationResult(
                    passed=False,
                    check_name="score_tier_consistency",
                    message=f"Score {score} suggests Research tier, but got {tier}",
                )
            )
        else:
            results.append(
                ValidationResult(
                    passed=True,
                    check_name="score_tier_consistency",
                    message="Score and tier are consistent",
                )
            )

        return results

    def validate_batch(self, results: List[Dict]) -> Tuple[int, int, List[Dict]]:
        """
        Validate a batch of results.

        Args:
            results: List of benchmark results

        Returns:
            Tuple of (passed_count, failed_count, failures)
        """
        passed_count = 0
        failed_count = 0
        failures = []

        for idx, result in enumerate(results):
            try:
                validations = self.validate_result_consistency(
                    accuracy=result.get("accuracy", 0),
                    latency=result.get("latency", 0),
                    cost=result.get("cost", 0),
                    score=result.get("final_score", 0),
                    tier=result.get("tier", "Research"),
                )

                if all(v.passed for v in validations):
                    passed_count += 1
                else:
                    failed_count += 1
                    failures.append(
                        {
                            "index": idx,
                            "model": result.get("model", "Unknown"),
                            "errors": [v.message for v in validations if not v.passed],
                        }
                    )

            except Exception as e:
                failed_count += 1
                failures.append(
                    {
                        "index": idx,
                        "model": result.get("model", "Unknown"),
                        "error": str(e),
                    }
                )

        if failed_count > 0:
            logger.warning(
                "batch_validation_failed",
                passed=passed_count,
                failed=failed_count,
                total=len(results),
            )

        return passed_count, failed_count, failures


class DataProfiler:
    """Profile benchmark data for quality insights."""

    @staticmethod
    def profile_results(results: List[Dict]) -> Dict:
        """
        Generate data profile for results.

        Args:
            results: List of benchmark results

        Returns:
            Profile statistics
        """
        if not results:
            return {
                "total_records": 0,
                "message": "No results to profile",
            }

        scores = [r.get("final_score", 0) for r in results]
        accuracies = [r.get("accuracy", 0) for r in results]
        latencies = [r.get("latency", 0) for r in results]
        costs = [r.get("cost", 0) for r in results]

        return {
            "total_records": len(results),
            "score": {
                "mean": round(sum(scores) / len(scores), 2),
                "min": min(scores),
                "max": max(scores),
                "std_dev": calculate_std_dev(scores),
            },
            "accuracy": {
                "mean": round(sum(accuracies) / len(accuracies), 2),
                "min": min(accuracies),
                "max": max(accuracies),
            },
            "latency": {
                "mean": round(sum(latencies) / len(latencies), 2),
                "min": min(latencies),
                "max": max(latencies),
                "unit": "ms",
            },
            "cost": {
                "mean": round(sum(costs) / len(costs), 4),
                "min": min(costs),
                "max": max(costs),
                "unit": "USD",
            },
            "profiled_at": utcnow().isoformat(),
        }


def calculate_std_dev(values: List[float]) -> float:
    """Calculate standard deviation."""
    if len(values) < 2:
        return 0.0

    mean = sum(values) / len(values)
    variance = sum((x - mean) ** 2 for x in values) / len(values)
    std_dev = variance**0.5

    return round(std_dev, 2)


if __name__ == "__main__":
    validator = BenchmarkDataValidator()

    # Example validation
    sample_result = {
        "model": "GPT-4o",
        "accuracy": 95.5,
        "latency": 245.3,
        "cost": 0.0015,
        "final_score": 90.22,
        "tier": "Production",
    }

    results = validator.validate_result_consistency(
        accuracy=sample_result["accuracy"],
        latency=sample_result["latency"],
        cost=sample_result["cost"],
        score=sample_result["final_score"],
        tier=sample_result["tier"],
    )

    for result in results:
        status = "✓" if result.passed else "✗"
        print(f"{status} {result.check_name}: {result.message}")
