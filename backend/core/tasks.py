"""
Celery tasks for async benchmarking and distributed processing.
Requires Redis for message broker and result backend.
"""

import asyncio
from typing import List, Optional, Dict
from celery import Celery, shared_task
from celery.result import AsyncResult
from datetime import datetime, timezone

from core.config import settings
from core.database import SessionLocal, Model, BenchmarkResult, BenchmarkTask
from core.engine import BenchmarkEngine
from core.logger import get_logger

logger = get_logger(__name__)


def utcnow() -> datetime:
    """Return a timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


# Initialize Celery
app = Celery(
    "benchmark",
    broker=settings.cache.url,
    backend=settings.cache.url,
)

app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    broker_connection_retry_on_startup=True,
    task_track_started=True,
    task_time_limit=30 * 60,  # 30 minutes hard limit
    task_soft_time_limit=25 * 60,  # 25 minutes soft limit
)


@shared_task(bind=True, max_retries=3)
def run_benchmark_task(
    self,
    model_names: List[str],
    dataset_id: Optional[int] = None,
) -> Dict:
    """
    Async task to run benchmark on models.

    Args:
        model_names: List of model names to benchmark
        dataset_id: Optional dataset ID

    Returns:
        Dict with benchmark results
    """
    task_id = self.request.id

    try:
        logger.info(
            "celery_task_started",
            task_id=task_id,
            model_count=len(model_names),
            dataset_id=dataset_id,
        )

        # Track task in database
        db = SessionLocal()
        try:
            task = BenchmarkTask(
                task_id=task_id,
                status="running",
                model_id=model_names[0] if model_names else None,
                dataset_id=dataset_id or 0,
                started_at=utcnow(),
            )
            db.add(task)
            db.commit()
        except Exception as e:
            logger.warning("failed_to_track_task", error=str(e))
        finally:
            db.close()

        # Run benchmark
        engine = BenchmarkEngine()
        results = engine.run_benchmark(
            models=model_names,
            dataset_id=dataset_id,
            save_to_db=True,
        )

        # Update task status
        db = SessionLocal()
        try:
            task = db.query(BenchmarkTask).filter_by(task_id=task_id).first()
            if task:
                task.status = "completed"
                task.completed_at = utcnow()
                db.commit()
        except Exception as e:
            logger.warning("failed_to_update_task", error=str(e))
        finally:
            db.close()

        logger.info(
            "celery_task_completed",
            task_id=task_id,
            result_count=len(results),
        )

        return {
            "task_id": task_id,
            "status": "completed",
            "results": results,
            "timestamp": utcnow().isoformat(),
        }

    except Exception as exc:
        logger.error(
            "celery_task_failed",
            task_id=task_id,
            error=str(exc),
            retry_count=self.request.retries,
        )

        # Update task status
        db = SessionLocal()
        try:
            task = db.query(BenchmarkTask).filter_by(task_id=task_id).first()
            if task:
                task.status = "failed"
                task.error_message = str(exc)
                task.completed_at = utcnow()
                db.commit()
        except Exception as e:
            logger.warning("failed_to_update_failed_task", error=str(e))
        finally:
            db.close()

        # Retry with exponential backoff
        if self.request.retries < self.max_retries:
            raise self.retry(
                exc=exc,
                countdown=2**self.request.retries,  # 1s, 2s, 4s
            )
        else:
            return {
                "task_id": task_id,
                "status": "failed",
                "error": str(exc),
                "timestamp": utcnow().isoformat(),
            }


@shared_task
def aggregate_results_task(
    dataset_id: Optional[int] = None,
    days: int = 7,
) -> Dict:
    """
    Aggregate benchmark results over time period.

    Args:
        dataset_id: Optional dataset ID to filter by
        days: Number of days to aggregate

    Returns:
        Aggregated statistics
    """
    try:
        db = SessionLocal()

        from sqlalchemy import func
        from datetime import datetime, timedelta

        # Query benchmarks from last N days
        cutoff_date = utcnow() - timedelta(days=days)

        query = db.query(BenchmarkResult).filter(
            BenchmarkResult.created_at >= cutoff_date
        )

        if dataset_id:
            query = query.filter(BenchmarkResult.dataset_id == dataset_id)

        results = query.all()

        if not results:
            return {
                "status": "no_data",
                "period_days": days,
            }

        # Calculate aggregates
        scores = [r.final_score for r in results]
        accuracies = [r.accuracy for r in results]
        latencies = [r.latency for r in results]
        costs = [r.cost for r in results]

        tiers = {}
        for r in results:
            tiers[r.tier] = tiers.get(r.tier, 0) + 1

        stats = {
            "period_days": days,
            "total_benchmarks": len(results),
            "avg_score": round(sum(scores) / len(scores), 2),
            "best_score": max(scores),
            "worst_score": min(scores),
            "avg_accuracy": round(sum(accuracies) / len(accuracies), 2),
            "avg_latency": round(sum(latencies) / len(latencies), 2),
            "avg_cost": round(sum(costs) / len(costs), 4),
            "tier_distribution": tiers,
            "timestamp": utcnow().isoformat(),
        }

        logger.info(
            "results_aggregated",
            period_days=days,
            benchmark_count=len(results),
        )

        return stats

    except Exception as e:
        logger.error("aggregation_failed", error=str(e))
        return {
            "status": "failed",
            "error": str(e),
        }

    finally:
        db.close()


@shared_task
def cleanup_old_results_task(days: int = 90) -> Dict:
    """
    Cleanup old benchmark results.

    Args:
        days: Delete results older than N days

    Returns:
        Cleanup statistics
    """
    try:
        db = SessionLocal()

        from datetime import datetime, timedelta

        cutoff_date = utcnow() - timedelta(days=days)

        # Delete old results
        deleted = (
            db.query(BenchmarkResult)
            .filter(BenchmarkResult.created_at < cutoff_date)
            .delete()
        )

        db.commit()

        logger.info(
            "cleanup_completed",
            deleted_count=deleted,
            cutoff_days=days,
        )

        return {
            "status": "completed",
            "deleted_results": deleted,
            "cutoff_days": days,
            "timestamp": utcnow().isoformat(),
        }

    except Exception as e:
        logger.error("cleanup_failed", error=str(e))
        return {
            "status": "failed",
            "error": str(e),
        }

    finally:
        db.close()


def get_task_status(task_id: str) -> Dict:
    """
    Get status of a Celery task.

    Args:
        task_id: Celery task ID

    Returns:
        Task status information
    """
    result = AsyncResult(task_id, app=app)

    return {
        "task_id": task_id,
        "status": result.status,
        "result": result.result if result.successful() else None,
        "error": str(result.info) if result.failed() else None,
    }


if __name__ == "__main__":
    # Run Celery worker
    app.start()
