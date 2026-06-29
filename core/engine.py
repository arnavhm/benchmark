"""
LLM Scoring Engine (Production-Grade)

This module calculates comprehensive LLM performance scores using a weighted formula
based on Accuracy, Latency, and Cost. Includes database persistence, validation,
and structured logging for production use.

Formula: S_final = (w_a * A) + (w_l * L) + (w_c * C)
where:
  - A: Accuracy (0-100)
  - L: Normalized Latency (0-100, higher is faster)
  - C: Normalized Cost (0-100, lower cost = higher score)
  - w_a=0.5, w_l=0.3, w_c=0.2 (weights)
"""

import json
import random
import os
import asyncio
import time
from typing import Dict, List, Tuple, Optional
from datetime import datetime

from sqlalchemy.orm import Session

from core.config import settings
from core.database import SessionLocal, Model, BenchmarkResult
from core.logger import get_logger
from core.validators import BenchmarkResultCreate, TierEnum

logger = get_logger(__name__)

# Optional: for real API calls
# import aiohttp


class BenchmarkEngine:
    """Production-grade LLM benchmark scoring engine."""

    # Scoring weights
    WEIGHT_ACCURACY = 0.5
    WEIGHT_LATENCY = 0.3
    WEIGHT_COST = 0.2

    # Normalization thresholds
    LATENCY_MAX_MS = 5000.0  # 5 seconds in milliseconds
    COST_MAX_USD = 0.10  # $0.10 per call

    # Tier boundaries
    TIER_PRODUCTION_MIN = 85.0
    TIER_ANALYSIS_MIN = 70.0

    def normalize_accuracy(self, accuracy: float) -> float:
        """Normalize accuracy to 0-100 scale."""
        if not (0 <= accuracy <= 100):
            raise ValueError("Accuracy must be between 0 and 100")
        return accuracy

    def normalize_latency(self, latency: float) -> float:
        """Normalize latency to 0-100 scale (higher is better)."""
        if latency < 0:
            raise ValueError("Latency cannot be negative")
        # Convert to 0-100 where 0ms = 100 and 5000ms = 0
        normalized = max(0, 100 * (1 - (latency / self.LATENCY_MAX_MS)))
        return round(normalized, 2)

    def normalize_cost(self, cost: float) -> float:
        """Normalize cost to 0-100 scale (higher is better)."""
        if cost < 0:
            raise ValueError("Cost cannot be negative")
        # Convert to 0-100 where $0 = 100 and $0.10 = 0
        normalized = max(0, 100 * (1 - (cost / self.COST_MAX_USD)))
        return round(normalized, 2)

    def calculate_score(self, accuracy: float, latency: float, cost: float) -> float:
        """
        Calculate the final LLM benchmark score using weighted formula.

        Args:
            accuracy: Semantic similarity score (0-100)
            latency: Response time in milliseconds
            cost: Cost per API call in dollars

        Returns:
            Final score normalized to 0-100 scale
        """
        # Validate inputs
        accuracy_norm = self.normalize_accuracy(accuracy)
        latency_norm = self.normalize_latency(latency)
        cost_norm = self.normalize_cost(cost)

        # Calculate weighted final score
        final_score = (
            (accuracy_norm * self.WEIGHT_ACCURACY)
            + (latency_norm * self.WEIGHT_LATENCY)
            + (cost_norm * self.WEIGHT_COST)
        )

        return round(final_score, 2)

    def determine_tier(self, score: float) -> TierEnum:
        """
        Determine deployment tier based on final score.

        Tier Breakdown:
        - Production Tier: score > 85 (Ready for real-time customer use)
        - Analysis Tier: 70 < score <= 85 (Better for offline/batch processing)
        - Research Tier: score <= 70 (Needs more fine-tuning)

        Args:
            score: Final benchmark score (0-100)

        Returns:
            Deployment tier enum
        """
        if score > self.TIER_PRODUCTION_MIN:
            return TierEnum.PRODUCTION
        elif score > self.TIER_ANALYSIS_MIN:
            return TierEnum.ANALYSIS
        else:
            return TierEnum.RESEARCH

    async def fetch_llm_response(
        self, model_name: str, prompt: Optional[str] = None
    ) -> Tuple[float, float, float]:
        """
        Simulate or fetch LLM response metrics asynchronously.

        In production, replace with actual API calls using aiohttp.

        Args:
            model_name: Name of the LLM model to benchmark
            prompt: Optional prompt to send to the model

        Returns:
            Tuple of (accuracy, latency_ms, cost_usd)
        """
        # Simulate API call with realistic delays
        await asyncio.sleep(random.uniform(0.1, 0.5))

        # Simulated metrics (replace with actual API response parsing)
        accuracy = round(random.uniform(70.0, 95.0), 2)
        latency = round(random.uniform(100.0, 3000.0), 2)  # milliseconds
        cost = round(random.uniform(0.001, 0.01), 4)  # dollars

        logger.info(
            "benchmark_fetched",
            model_name=model_name,
            accuracy=accuracy,
            latency=latency,
            cost=cost,
        )

        return accuracy, latency, cost

    async def run_benchmark_async(
        self, models: Optional[List[str]] = None, dataset_id: Optional[int] = None
    ) -> List[Dict]:
        """
        Run benchmark on multiple LLM models in parallel using asyncio.

        Args:
            models: List of model names to benchmark
            dataset_id: Optional dataset ID for tracking

        Returns:
            List of benchmark results
        """
        if models is None:
            models = ["GPT-4o", "Claude-3.5", "Llama-3"]

        logger.info("benchmark_started", model_count=len(models), dataset_id=dataset_id)

        # Create concurrent tasks for all models
        tasks = [self.fetch_llm_response(model) for model in models]

        # Execute all tasks concurrently
        start_time = time.time()
        responses = await asyncio.gather(*tasks, return_exceptions=True)
        total_time = time.time() - start_time

        # Compile results with error handling
        results = []
        for model, response in zip(models, responses):
            if isinstance(response, Exception):
                logger.error("benchmark_failed", model_name=model, error=str(response))
                continue

            accuracy, latency, cost = response

            try:
                score = self.calculate_score(accuracy, latency, cost)
                tier = self.determine_tier(score)

                results.append(
                    {
                        "model": model,
                        "accuracy": accuracy,
                        "latency": latency,
                        "cost": cost,
                        "final_score": score,
                        "tier": tier.value,
                        "execution_time": total_time / len(models),
                        "status": "success",
                    }
                )
            except ValueError as e:
                logger.warning(
                    "benchmark_validation_error", model_name=model, error=str(e)
                )

        logger.info(
            "benchmark_completed",
            model_count=len(results),
            total_time=round(total_time, 2),
            speedup=round(sum(r["latency"] for r in results) / total_time, 2)
            if results
            else 0,
        )

        return results

    def save_results_to_database(
        self, results: List[Dict], db: Session, dataset_id: Optional[int] = None
    ) -> int:
        """
        Save benchmark results to database.

        Args:
            results: List of benchmark results
            db: Database session
            dataset_id: Optional dataset ID

        Returns:
            Number of results saved
        """
        saved_count = 0

        for result in results:
            try:
                # Create and validate result using Pydantic
                validated_result = BenchmarkResultCreate(
                    model_name=result["model"],
                    accuracy=result["accuracy"],
                    latency=result["latency"],
                    cost=result["cost"],
                    accuracy_norm=self.normalize_accuracy(result["accuracy"]),
                    latency_norm=self.normalize_latency(result["latency"]),
                    cost_norm=self.normalize_cost(result["cost"]),
                    final_score=result["final_score"],
                    tier=result["tier"],
                    execution_time=result["execution_time"],
                    dataset_id=dataset_id,
                    status=result.get("status", "success"),
                )

                # Look up model or create it
                model_name = validated_result.model_name
                db_model = db.query(Model).filter_by(name=model_name).first()
                if not db_model:
                    # Determine provider
                    name_lower = model_name.lower()
                    if "gpt" in name_lower or "o1" in name_lower:
                        provider = "OpenAI"
                    elif "claude" in name_lower:
                        provider = "Anthropic"
                    elif "llama" in name_lower:
                        provider = "Meta"
                    elif "gemini" in name_lower:
                        provider = "Google"
                    else:
                        provider = "Unknown"
                    
                    db_model = Model(name=model_name, provider=provider)
                    db.add(db_model)
                    db.flush()  # Populate the ID of the model

                # Create database record
                db_result = BenchmarkResult(
                    model_id=db_model.id,
                    model_name=validated_result.model_name,
                    dataset_id=dataset_id,
                    accuracy=validated_result.accuracy,
                    latency=validated_result.latency,
                    cost=validated_result.cost,
                    accuracy_norm=validated_result.accuracy_norm,
                    latency_norm=validated_result.latency_norm,
                    cost_norm=validated_result.cost_norm,
                    final_score=validated_result.final_score,
                    tier=validated_result.tier,
                    execution_time=validated_result.execution_time,
                    status=validated_result.status,
                )

                db.add(db_result)
                saved_count += 1

            except Exception as e:
                logger.error(
                    "result_save_failed", model_name=result.get("model"), error=str(e)
                )

        try:
            db.commit()
            logger.info("benchmark_results_saved", count=saved_count)
        except Exception as e:
            db.rollback()
            logger.error("commit_failed", error=str(e))
            saved_count = 0

        return saved_count

    def save_results_to_json(
        self, results: List[Dict], output_path: str = "data/results.json"
    ) -> bool:
        """
        Save benchmark results to JSON file (fallback).

        Args:
            results: List of benchmark results
            output_path: Path to save JSON file

        Returns:
            True if successful, False otherwise
        """
        try:
            os.makedirs(os.path.dirname(output_path), exist_ok=True)

            with open(output_path, "w") as f:
                json.dump(results, f, indent=2)

            logger.info("results_saved_json", path=output_path)
            return True
        except Exception as e:
            logger.error("json_save_failed", error=str(e))
            return False

    def run_benchmark(
        self,
        models: Optional[List[str]] = None,
        dataset_id: Optional[int] = None,
        save_to_db: bool = True,
    ) -> List[Dict]:
        """
        Synchronous wrapper to run async benchmark.

        Args:
            models: List of model names to benchmark
            dataset_id: Optional dataset ID
            save_to_db: Whether to save results to database

        Returns:
            List of benchmark results
        """
        # Run async benchmark
        results = asyncio.run(self.run_benchmark_async(models, dataset_id))

        # Save to database if requested and configured
        if save_to_db and settings.database.url != "sqlite:///:memory:":
            try:
                db = SessionLocal()
                self.save_results_to_database(results, db, dataset_id)
                db.close()
            except Exception as e:
                logger.warning("database_save_failed", error=str(e))

        # Always save to JSON for compatibility
        self.save_results_to_json(results)

        # Print results table
        self._print_results_table(results)

        return results

    def _print_results_table(self, results: List[Dict]):
        """Print benchmark results in formatted table."""
        print("\n" + "=" * 80)
        print("LLM BENCHMARK RESULTS")
        print("=" * 80)

        for r in results:
            print(f"\n{r['model']}")
            print(f"  Accuracy:         {r['accuracy']:.2f}%")
            print(f"  Latency:          {r['latency']:.2f}ms")
            print(f"  Cost:             ${r['cost']:.6f}")
            print(f"  Final Score:      {r['final_score']:.2f}/100")
            print(f"  Deployment Tier:  {r['tier']}")

        print("\n" + "=" * 80)
        print("Results saved to data/results.json")
        print("=" * 80 + "\n")


def create_engine() -> BenchmarkEngine:
    """Factory function to create benchmark engine."""
    return BenchmarkEngine()


if __name__ == "__main__":
    # Initialize engine and run benchmark
    engine = create_engine()

    # Run benchmark with default models
    engine.run_benchmark()
