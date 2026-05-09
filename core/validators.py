"""
Pydantic v2 validators for API input/output validation.
Ensures data integrity across the application.
"""

from enum import Enum
from datetime import datetime, timezone
from typing import Optional, List

from pydantic import BaseModel, ConfigDict, Field, field_validator


def utcnow() -> datetime:
    """Return a timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


class TierEnum(str, Enum):
    """Deployment tier classification."""

    PRODUCTION = "Production"
    ANALYSIS = "Analysis"
    RESEARCH = "Research"


class ModelBase(BaseModel):
    """Base model for LLM information."""

    name: str = Field(..., min_length=1, max_length=255)
    provider: str = Field(..., min_length=1, max_length=100)
    version: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = None


class ModelCreate(ModelBase):
    """Schema for creating a new model."""

    pass


class ModelResponse(ModelBase):
    """Schema for model API response."""

    id: int
    active: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BenchmarkMetrics(BaseModel):
    """Benchmark metrics validation."""

    accuracy: float = Field(..., ge=0, le=100)
    latency: float = Field(..., ge=0)  # milliseconds
    cost: float = Field(..., ge=0)  # dollars

    @field_validator("accuracy")
    def validate_accuracy(cls, v):
        if not (0 <= v <= 100):
            raise ValueError("Accuracy must be between 0 and 100")
        return round(v, 2)

    @field_validator("latency")
    def validate_latency(cls, v):
        if v < 0:
            raise ValueError("Latency cannot be negative")
        return round(v, 3)

    @field_validator("cost")
    def validate_cost(cls, v):
        if v < 0:
            raise ValueError("Cost cannot be negative")
        return round(v, 6)


class BenchmarkResultBase(BaseModel):
    """Base benchmark result data."""

    model_name: str = Field(..., min_length=1, max_length=255)

    # Metrics
    accuracy: float = Field(..., ge=0, le=100)
    latency: float = Field(..., ge=0)
    cost: float = Field(..., ge=0)

    # Scores (normalized)
    accuracy_norm: float = Field(..., ge=0, le=100)
    latency_norm: float = Field(..., ge=0, le=100)
    cost_norm: float = Field(..., ge=0, le=100)

    # Final score
    final_score: float = Field(..., ge=0, le=100)
    tier: TierEnum

    # Metadata
    execution_time: float = Field(..., ge=0)  # milliseconds

    @field_validator("final_score")
    def validate_final_score(cls, v):
        if not (0 <= v <= 100):
            raise ValueError("Final score must be between 0 and 100")
        return round(v, 2)


class BenchmarkResultCreate(BenchmarkResultBase):
    """Schema for creating a benchmark result."""

    dataset_id: Optional[int] = None
    model_response: Optional[str] = None
    error_message: Optional[str] = None
    status: str = Field(default="success")


class BenchmarkResultResponse(BenchmarkResultBase):
    """Schema for benchmark result API response."""

    id: int
    model_id: int
    dataset_id: Optional[int]
    model_response: Optional[str]
    error_message: Optional[str]
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DatasetBase(BaseModel):
    """Base dataset information."""

    name: str = Field(..., min_length=1, max_length=255)
    category: str = Field(..., min_length=1, max_length=100)
    domain: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    samples: int = Field(default=0, ge=0)


class DatasetCreate(DatasetBase):
    """Schema for creating a dataset."""

    pass


class DatasetResponse(DatasetBase):
    """Schema for dataset API response."""

    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BenchmarkRequest(BaseModel):
    """Schema for benchmark execution request."""

    model_names: List[str] = Field(..., min_length=1)
    dataset_id: Optional[int] = None
    timeout: Optional[int] = Field(None, ge=1)

    @field_validator("model_names")
    def validate_model_names(cls, v):
        if not v:
            raise ValueError("At least one model name required")
        if len(v) > 100:
            raise ValueError("Cannot benchmark more than 100 models at once")
        return v


class BenchmarkResponse(BaseModel):
    """Schema for benchmark execution response."""

    task_id: str
    status: str
    models_count: int
    estimated_time: float  # seconds
    created_at: datetime


class AggregateStats(BaseModel):
    """Aggregate statistics for results."""

    total_benchmarks: int = Field(..., ge=0)
    avg_score: float = Field(..., ge=0, le=100)
    best_score: float = Field(..., ge=0, le=100)
    worst_score: float = Field(..., ge=0, le=100)

    production_count: int = Field(..., ge=0)
    analysis_count: int = Field(..., ge=0)
    research_count: int = Field(..., ge=0)

    avg_accuracy: float = Field(..., ge=0, le=100)
    avg_latency: float = Field(..., ge=0)
    avg_cost: float = Field(..., ge=0)


class HealthCheck(BaseModel):
    """Health check response."""

    status: str
    version: str
    timestamp: datetime
    checks: dict = Field(default_factory=dict)


if __name__ == "__main__":
    # Test validators
    metrics = BenchmarkMetrics(accuracy=95.5, latency=245.3, cost=0.0015)
    print(f"Valid metrics: {metrics}")

    result = BenchmarkResultResponse(
        id=1,
        model_name="GPT-4o",
        model_id=1,
        dataset_id=None,
        accuracy=95.5,
        latency=245.3,
        cost=0.0015,
        accuracy_norm=95.5,
        latency_norm=85.2,
        cost_norm=92.1,
        final_score=90.22,
        tier=TierEnum.PRODUCTION,
        execution_time=245.3,
        model_response=None,
        error_message=None,
        status="success",
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    print(f"Valid result: {result}")
