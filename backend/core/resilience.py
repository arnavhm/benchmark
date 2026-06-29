"""
Resilience patterns for production reliability.
Includes circuit breaker, retry logic, and timeout handling.
"""

import asyncio
from typing import Callable, Any, Optional, TypeVar
from enum import Enum
import time
from datetime import datetime, timezone
from functools import wraps

from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    RetryError,
)

from core.logger import get_logger

logger = get_logger(__name__)

T = TypeVar("T")


def utcnow() -> datetime:
    """Return a timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


class CircuitState(Enum):
    """Circuit breaker states."""

    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreaker:
    """
    Circuit breaker pattern implementation for fault tolerance.

    States:
    - CLOSED: Normal operation, requests pass through
    - OPEN: Fault detected, requests fail immediately
    - HALF_OPEN: Testing if service is recovered
    """

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: int = 60,
        expected_exception: type = Exception,
    ):
        """
        Initialize circuit breaker.

        Args:
            failure_threshold: Number of failures before opening
            recovery_timeout: Seconds before attempting recovery
            expected_exception: Exception type to catch
        """
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.expected_exception = expected_exception

        self._failure_count = 0
        self._success_count = 0
        self._last_failure_time: Optional[datetime] = None
        self._state = CircuitState.CLOSED

    @property
    def state(self) -> CircuitState:
        """Get current circuit state."""
        if self._state == CircuitState.OPEN:
            if self._should_attempt_reset():
                self._state = CircuitState.HALF_OPEN
                self._success_count = 0
                logger.info("circuit_breaker_half_open")
        return self._state

    def _should_attempt_reset(self) -> bool:
        """Check if recovery timeout has elapsed."""
        if self._last_failure_time is None:
            return False

        elapsed = (utcnow() - self._last_failure_time).total_seconds()
        return elapsed >= self.recovery_timeout

    def call(self, func: Callable[..., T], *args, **kwargs) -> T:
        """
        Execute function with circuit breaker protection.

        Args:
            func: Function to execute
            *args: Function positional arguments
            **kwargs: Function keyword arguments

        Returns:
            Function result

        Raises:
            RuntimeError: If circuit is open
        """
        if self.state == CircuitState.OPEN:
            logger.error("circuit_breaker_open", function=func.__name__)
            raise RuntimeError(f"Circuit breaker is OPEN for {func.__name__}")

        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except self.expected_exception as e:
            self._on_failure()
            raise

    def _on_success(self):
        """Handle successful call."""
        self._failure_count = 0

        if self._state == CircuitState.HALF_OPEN:
            self._success_count += 1
            if self._success_count >= 2:
                self._state = CircuitState.CLOSED
                logger.info("circuit_breaker_closed")

    def _on_failure(self):
        """Handle failed call."""
        self._failure_count += 1
        self._last_failure_time = utcnow()

        if self._failure_count >= self.failure_threshold:
            self._state = CircuitState.OPEN
            logger.warning(
                "circuit_breaker_open",
                failure_count=self._failure_count,
                threshold=self.failure_threshold,
            )


def with_circuit_breaker(
    failure_threshold: int = 5,
    recovery_timeout: int = 60,
):
    """
    Decorator to add circuit breaker to a function.

    Args:
        failure_threshold: Failures before opening
        recovery_timeout: Timeout before attempting recovery
    """
    breaker = CircuitBreaker(failure_threshold, recovery_timeout)

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            return breaker.call(func, *args, **kwargs)

        return wrapper

    return decorator


def with_retry(
    max_attempts: int = 3,
    wait_multiplier: float = 1.0,
    wait_min: int = 1,
    wait_max: int = 10,
):
    """
    Decorator to add exponential backoff retry logic.

    Args:
        max_attempts: Maximum number of retry attempts
        wait_multiplier: Exponential backoff multiplier
        wait_min: Minimum wait time in seconds
        wait_max: Maximum wait time in seconds
    """

    def decorator(func: Callable) -> Callable:
        @retry(
            stop=stop_after_attempt(max_attempts),
            wait=wait_exponential(
                multiplier=wait_multiplier,
                min=wait_min,
                max=wait_max,
            ),
            retry=retry_if_exception_type(Exception),
        )
        @wraps(func)
        def wrapper(*args, **kwargs):
            return func(*args, **kwargs)

        return wrapper

    return decorator


class RateLimiter:
    """Token bucket rate limiter for API calls."""

    def __init__(
        self,
        rate: float,
        capacity: int = 1,
    ):
        """
        Initialize rate limiter.

        Args:
            rate: Tokens per second
            capacity: Maximum tokens (bucket size)
        """
        self.rate = rate
        self.capacity = capacity
        self.tokens = capacity
        self.last_update = time.time()

    def acquire(self, tokens: int = 1) -> bool:
        """
        Try to acquire tokens without blocking.

        Args:
            tokens: Number of tokens to acquire

        Returns:
            True if acquired, False otherwise
        """
        now = time.time()
        elapsed = now - self.last_update

        # Add new tokens based on elapsed time
        self.tokens = min(self.capacity, self.tokens + (elapsed * self.rate))
        self.last_update = now

        if self.tokens >= tokens:
            self.tokens -= tokens
            return True

        return False

    async def acquire_async(self, tokens: int = 1, timeout: float = 5.0):
        """
        Acquire tokens with async retry.

        Args:
            tokens: Number of tokens to acquire
            timeout: Maximum time to wait in seconds

        Raises:
            asyncio.TimeoutError: If timeout exceeded
        """
        start_time = time.time()

        while not self.acquire(tokens):
            elapsed = time.time() - start_time
            if elapsed > timeout:
                raise asyncio.TimeoutError(f"Rate limit timeout after {elapsed}s")

            # Exponential backoff
            wait_time = min(1.0, (1.0 / self.rate))
            await asyncio.sleep(wait_time)


class BulkheadPattern:
    """
    Bulkhead pattern for isolating resources and preventing cascading failures.
    Limits number of concurrent executions.
    """

    def __init__(self, max_concurrent: int = 10):
        """
        Initialize bulkhead.

        Args:
            max_concurrent: Maximum concurrent executions
        """
        self.max_concurrent = max_concurrent
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.active_count = 0

    async def execute(self, coro):
        """
        Execute coroutine with bulkhead protection.

        Args:
            coro: Coroutine to execute

        Returns:
            Coroutine result
        """
        async with self.semaphore:
            self.active_count += 1
            try:
                return await coro
            finally:
                self.active_count -= 1

    def get_active_count(self) -> int:
        """Get number of active executions."""
        return self.active_count


class TimeoutHandler:
    """Timeout handling for operations."""

    @staticmethod
    async def with_timeout(coro, timeout: float):
        """
        Execute coroutine with timeout.

        Args:
            coro: Coroutine to execute
            timeout: Timeout in seconds

        Returns:
            Coroutine result

        Raises:
            asyncio.TimeoutError: If timeout exceeded
        """
        try:
            return await asyncio.wait_for(coro, timeout=timeout)
        except asyncio.TimeoutError:
            logger.error("operation_timeout", timeout=timeout)
            raise


# Create global instances
circuit_breaker = CircuitBreaker(failure_threshold=5, recovery_timeout=60)
rate_limiter = RateLimiter(rate=10.0, capacity=100)
bulkhead = BulkheadPattern(max_concurrent=10)


if __name__ == "__main__":
    # Example usage
    @with_circuit_breaker(failure_threshold=3)
    @with_retry(max_attempts=3)
    def example_function(x: int) -> int:
        """Example function with resilience patterns."""
        if x < 0:
            raise ValueError("x must be positive")
        return x * 2

    try:
        result = example_function(5)
        print(f"Result: {result}")
    except Exception as e:
        print(f"Error: {e}")
