FROM python:3.11-slim as base

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    git \
    && rm -rf /var/lib/apt/lists/*


# Development stage
FROM base as development

RUN pip install --upgrade pip setuptools wheel

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Create non-root user for security
RUN useradd -m -u 1000 benchmark && chown -R benchmark:benchmark /app
USER benchmark

EXPOSE 5002
CMD ["python", "-m", "web.server"]


# Production stage (minimal)
FROM base as production

RUN pip install --upgrade pip setuptools wheel

# Copy only production requirements
COPY requirements.txt .
RUN grep -v '^#' requirements.txt | grep -v pytest | grep -v black | grep -v isort | grep -v flake8 | grep -v pylint | grep -v mypy | pip install -r /dev/stdin

COPY --chown=1000:1000 . .

# Create non-root user
RUN useradd -m -u 1000 benchmark && chown -R benchmark:benchmark /app
USER benchmark

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:5002/health')" || exit 1

EXPOSE 5002
CMD ["python", "-m", "web.server"]


# Testing stage
FROM development as testing

RUN pip install pytest-xdist

COPY . .

CMD ["pytest", "-v", "--cov=core", "--cov=src", "--cov-report=term-missing"]
