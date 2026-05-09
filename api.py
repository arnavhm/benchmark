"""
Enterprise-grade API with versioning, authentication, and rate limiting.
Uses FastAPI for async request handling and automatic OpenAPI documentation.
"""

from fastapi import (
    FastAPI,
    HTTPException,
    Depends,
    APIRouter,
    Header,
    status,
)
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.openapi.utils import get_openapi
from typing import Optional, List, Dict
from datetime import datetime, timedelta, timezone
from functools import wraps
import jwt
from passlib.context import CryptContext
from sqlalchemy import text

from core.config import settings
from core.logger import get_logger
from core.validators import (
    BenchmarkRequest,
    BenchmarkResponse,
    BenchmarkResultResponse,
    HealthCheck,
)
from core.database import SessionLocal, get_db, BenchmarkResult, Model
from core.engine import BenchmarkEngine
from core.resilience import rate_limiter

logger = get_logger(__name__)


def utcnow() -> datetime:
    """Return a timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT configuration
SECRET_KEY = "your-secret-key-change-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30


# ============================================================================
# Authentication
# ============================================================================


class TokenData:
    """JWT token data."""

    def __init__(self, sub: str, exp: int, scopes: List[str] = None):
        self.sub = sub
        self.exp = exp
        self.scopes = scopes or []


def create_access_token(data: Dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create JWT access token."""
    to_encode = data.copy()

    if expires_delta:
        expire = utcnow() + expires_delta
    else:
        expire = utcnow() + timedelta(minutes=15)

    to_encode.update({"exp": expire})

    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_token(token: str) -> Dict:
    """Verify JWT token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_user(
    authorization: Optional[str] = Header(None),
) -> Dict:
    """Dependency to get current user from token."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        scheme, token = authorization.split()
        if scheme.lower() != "bearer":
            raise HTTPException(status_code=401, detail="Invalid authentication scheme")
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    return verify_token(token)


# ============================================================================
# FastAPI Application
# ============================================================================


def create_app() -> FastAPI:
    """Create and configure FastAPI application."""

    app = FastAPI(
        title="LLM Benchmark API",
        description="Enterprise-grade API for benchmarking LLM models",
        version=settings.api.version,
    )

    # Middleware
    app.add_middleware(GZipMiddleware, minimum_size=1000)  # Compression
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Custom OpenAPI schema
    def custom_openapi():
        if app.openapi_schema:
            return app.openapi_schema

        openapi_schema = get_openapi(
            title="LLM Benchmark API",
            version=settings.api.version,
            description="Enterprise-grade API for benchmarking LLM models",
            routes=app.routes,
        )

        # Add authentication
        openapi_schema["components"]["securitySchemes"] = {
            "BearerAuth": {
                "type": "http",
                "scheme": "bearer",
                "bearerFormat": "JWT",
            }
        }

        app.openapi_schema = openapi_schema
        return app.openapi_schema

    app.openapi = custom_openapi

    # ========================================================================
    # Health Check
    # ========================================================================

    @app.get("/health", tags=["Health"])
    async def health_check():
        """Health check endpoint."""
        return {
            "status": "healthy",
            "version": settings.api.version,
            "timestamp": utcnow(),
            "checks": {
                "api": "ok",
                "database": "ok" if check_database() else "error",
                "cache": "ok" if check_cache() else "error",
            },
        }

    # ========================================================================
    # Authentication
    # ========================================================================

    @app.post("/api/v1/auth/login", tags=["Authentication"])
    async def login(username: str, password: str):
        """Login endpoint (mock implementation)."""
        # In production, verify against user database
        if not username or not password:
            raise HTTPException(status_code=400, detail="Invalid credentials")

        # Create token
        access_token = create_access_token(
            data={"sub": username},
            expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        )

        logger.info("user_login", username=username)

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        }

    # ========================================================================
    # V1 API Routes
    # ========================================================================

    v1_router = APIRouter(prefix="/api/v1", tags=["v1"])

    @v1_router.post("/benchmark", response_model=BenchmarkResponse)
    async def run_benchmark(
        request: BenchmarkRequest,
        current_user: Dict = Depends(get_current_user),
        db=Depends(get_db),
    ):
        """
        Run benchmark on specified models.

        Requires authentication with valid JWT token.
        """
        # Rate limiting
        if not rate_limiter.acquire(1):
            raise HTTPException(status_code=429, detail="Rate limit exceeded")

        try:
            logger.info(
                "benchmark_requested",
                user=current_user.get("sub"),
                model_count=len(request.model_names),
            )

            engine = BenchmarkEngine()
            results = engine.run_benchmark(
                models=request.model_names,
                save_to_db=True,
            )

            task_id = f"task-{utcnow().timestamp()}"

            return BenchmarkResponse(
                task_id=task_id,
                status="completed",
                models_count=len(results),
                estimated_time=len(results) * 0.5,
                created_at=utcnow(),
            )

        except Exception as e:
            logger.error("benchmark_error", error=str(e))
            raise HTTPException(status_code=500, detail="Benchmark failed")

    @v1_router.get("/benchmark/{task_id}")
    async def get_benchmark_status(
        task_id: str,
        current_user: Dict = Depends(get_current_user),
    ):
        """Get benchmark task status."""
        # Implementation would query Celery or database
        return {
            "task_id": task_id,
            "status": "pending",
            "created_at": utcnow(),
        }

    @v1_router.get("/results", response_model=List[BenchmarkResultResponse])
    async def get_results(
        limit: int = 10,
        offset: int = 0,
        tier: Optional[str] = None,
        current_user: Dict = Depends(get_current_user),
        db=Depends(get_db),
    ):
        """Get benchmark results with optional filtering."""
        try:
            query = db.query(BenchmarkResult)

            if tier:
                query = query.filter_by(tier=tier)

            results = query.limit(limit).offset(offset).all()

            return results

        except Exception as e:
            logger.error("fetch_results_error", error=str(e))
            raise HTTPException(status_code=500, detail="Failed to fetch results")

    @v1_router.get("/results/best")
    async def get_best_results(
        limit: int = 5,
        current_user: Dict = Depends(get_current_user),
        db=Depends(get_db),
    ):
        """Get top performing models."""
        try:
            results = (
                db.query(BenchmarkResult)
                .order_by(BenchmarkResult.final_score.desc())
                .limit(limit)
                .all()
            )

            return results

        except Exception as e:
            logger.error("best_results_error", error=str(e))
            raise HTTPException(status_code=500, detail="Failed to fetch results")

    @v1_router.get("/stats")
    async def get_statistics(
        current_user: Dict = Depends(get_current_user),
        db=Depends(get_db),
    ):
        """Get aggregate statistics."""
        try:
            from sqlalchemy import func

            stmt = db.query(
                func.count(BenchmarkResult.id).label("total"),
                func.avg(BenchmarkResult.final_score).label("avg_score"),
                func.max(BenchmarkResult.final_score).label("max_score"),
                func.min(BenchmarkResult.final_score).label("min_score"),
            )

            stats = stmt.first()

            return {
                "total_benchmarks": stats.total or 0,
                "avg_score": round(stats.avg_score or 0, 2),
                "best_score": stats.max_score or 0,
                "worst_score": stats.min_score or 0,
                "timestamp": utcnow().isoformat(),
            }

        except Exception as e:
            logger.error("stats_error", error=str(e))
            raise HTTPException(status_code=500, detail="Failed to fetch statistics")

    app.include_router(v1_router)

    # ========================================================================
    # Error Handlers
    # ========================================================================

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request, exc):
        """Custom HTTP exception handler."""
        logger.warning(
            "http_exception",
            status_code=exc.status_code,
            detail=exc.detail,
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
        )

    @app.exception_handler(Exception)
    async def general_exception_handler(request, exc):
        """General exception handler."""
        logger.error("unhandled_exception", error=str(exc))
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
        )

    return app


def check_database() -> bool:
    """Check if database is accessible."""
    try:
        from core.database import SessionLocal

        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        return True
    except Exception:
        return False


def check_cache() -> bool:
    """Check if cache is accessible."""
    try:
        import redis

        r = redis.from_url(settings.cache.url)
        r.ping()
        return True
    except Exception:
        return False


# Application instance
app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=settings.api.host,
        port=settings.api.port,
        workers=4,
    )
