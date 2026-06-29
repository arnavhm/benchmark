# Quick Start Guide - Production Features

This guide covers using the new production-grade features.

## Table of Contents

1. [Local Setup](#local-setup)
2. [Running Benchmarks](#running-benchmarks)
3. [Using the API](#using-the-api)
4. [Monitoring](#monitoring)
5. [Testing](#testing)
6. [Troubleshooting](#troubleshooting)

---

## Local Setup

### 1. Clone and Install

```bash
cd /Users/arnavhmutt/Desktop/benchmark

# Install dependencies
pip install -r requirements.txt

# Setup Git hooks
pre-commit install

# Create environment file
cp .env.example .env
```

### 2. Start Database and Cache

**Option A: Docker Compose (Recommended)**

```bash
# Start all services (PostgreSQL, Redis, Prometheus, Grafana, ELK)
docker-compose up -d

# Verify services are running
docker-compose ps

# View logs
docker-compose logs -f app
```

**Option B: Manual Setup**

```bash
# Start PostgreSQL (must be installed)
postgres -D /usr/local/var/postgres

# Start Redis
redis-server

# Initialize database
python -c "from core.database import init_db; init_db()"
```

### 3. Start Application

**With Node.js (existing):**

```bash
node web/server.js
# Access dashboard: http://localhost:3000
```

**With FastAPI (new):**

```bash
python -m uvicorn api:app --reload --port 8000
# Access API docs: http://localhost:8000/docs
```

---

## Running Benchmarks

### Option 1: Direct Execution

```bash
# Generate synthetic data
python core/generator.py

# Run benchmark engine
python core/engine.py

# Results saved to data/results.json
# Database updated automatically
```

### Option 2: Async API Call

```bash
# Get API token
TOKEN=$(curl -X POST http://localhost:8000/api/v1/auth/login \
  -d "username=admin&password=secret" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  | jq -r '.access_token')

# Run benchmark via API
curl -X POST http://localhost:8000/api/v1/benchmark \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model_names": ["GPT-4o", "Claude-3.5", "Llama-3"],
    "timeout": 300
  }' | jq

# Expected response:
# {
#   "task_id": "task-...",
#   "status": "completed",
#   "models_count": 3,
#   "estimated_time": 1.5,
#   "created_at": "2026-05-08T..."
# }
```

### Option 3: Celery Background Task

```python
from core.tasks import run_benchmark_task, get_task_status

# Queue background task
task = run_benchmark_task.delay(
    ["GPT-4o", "Claude-3.5"],
    dataset_id=1
)

# Check status
print(f"Task ID: {task.id}")
print(f"Status: {task.status}")

# Get task status later
status = get_task_status(task.id)
print(status)
# {
#   "task_id": "...",
#   "status": "completed",
#   "result": {...},
#   "error": None
# }
```

---

## Using the API

### 1. Authentication

```bash
# Get token (valid for 30 minutes)
curl -X POST http://localhost:8000/api/v1/auth/login \
  -d "username=admin&password=secret" \
  -H "Content-Type: application/x-www-form-urlencoded"

# Response:
# {
#   "access_token": "eyJ...",
#   "token_type": "bearer",
#   "expires_in": 1800
# }
```

### 2. Run Benchmark

```bash
curl -X POST http://localhost:8000/api/v1/benchmark \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model_names": ["GPT-4o", "Claude-3.5"],
    "timeout": 300
  }'
```

### 3. Get Results

```bash
# All results
curl http://localhost:8000/api/v1/results \
  -H "Authorization: Bearer $TOKEN"

# Filter by tier
curl "http://localhost:8000/api/v1/results?tier=Production" \
  -H "Authorization: Bearer $TOKEN"

# Best performers
curl http://localhost:8000/api/v1/results/best \
  -H "Authorization: Bearer $TOKEN"

# Statistics
curl http://localhost:8000/api/v1/stats \
  -H "Authorization: Bearer $TOKEN"
```

### 4. View API Documentation

Open browser: http://localhost:8000/docs

Features:

- Interactive request/response testing
- Schema validation
- Authentication examples
- Parameter documentation

---

## Monitoring

### 1. Access Grafana Dashboards

```
URL: http://localhost:3000
Username: admin
Password: admin
```

Dashboards:

- LLM Benchmark Monitoring - Main dashboard
- Score Distribution - Histogram of final scores
- Model Tier Distribution - Pie chart
- API Response Time - Performance metrics

### 2. View Prometheus Metrics

```
URL: http://localhost:9090
```

Useful queries:

```promql
# Average benchmark score
avg(benchmark_final_score)

# Error rate
rate(benchmark_errors_total[5m])

# API response time (p95)
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Database query time
rate(pg_stat_statements_calls[5m])
```

### 3. View Logs in Kibana

```
URL: http://localhost:5601
```

Search examples:

```
# All errors
level:ERROR

# Benchmarks in last hour
event:benchmark_completed AND @timestamp:[now-1h TO now]

# User actions
user:admin
```

### 4. Check Alerts

Prometheus Alerts tab shows:

- High error rate
- Slow queries
- Memory issues
- Timeout violations

---

## Testing

### 1. Run All Tests

```bash
# With coverage
pytest tests/ -v --cov=core --cov=src --cov-report=html

# Specific test file
pytest tests/test_engine.py -v

# Specific test
pytest tests/test_engine.py::TestBenchmarkEngine::test_calculate_score_perfect -v

# Markers
pytest -m unit tests/      # Unit tests only
pytest -m integration tests/  # Integration tests only
```

### 2. Run Tests in Docker

```bash
docker-compose exec app pytest tests/ -v --cov
```

### 3. View Coverage Report

```bash
pytest tests/ --cov --cov-report=html
open htmlcov/index.html  # macOS
xdg-open htmlcov/index.html  # Linux
```

---

## Troubleshooting

### Issue: `ModuleNotFoundError: No module named 'core'`

**Solution:** Add current directory to PYTHONPATH

```bash
export PYTHONPATH="${PYTHONPATH}:$(pwd)"
python core/engine.py
```

### Issue: Database connection refused

**Solution:** Ensure PostgreSQL is running

```bash
# Using Docker Compose
docker-compose up postgres -d

# Using local PostgreSQL
brew services start postgresql  # macOS
sudo systemctl start postgresql  # Linux
```

### Issue: Can't connect to Redis

**Solution:** Start Redis service

```bash
# Using Docker Compose
docker-compose up redis -d

# Using local Redis
redis-server
```

### Issue: Port already in use

**Solution:** Specify different port

```bash
# FastAPI
python -m uvicorn api:app --port 9000

# Node.js
PORT=3001 node web/server.js

# Docker Compose
docker-compose down  # Stop existing
docker-compose up -d  # Start fresh
```

### Issue: Tests failing with database errors

**Solution:** Reset test database

```bash
pytest tests/ --cov -v --tb=short

# Or manually reset
python -c "from core.database import drop_db; drop_db()"
python -c "from core.database import init_db; init_db()"
```

### Issue: Pre-commit hooks preventing commit

**Solution:** Run formatters

```bash
# Auto-format
black core src tests
isort core src tests

# Check and fix
pre-commit run --all-files
```

---

## Common Commands

```bash
# Generate data
python core/generator.py

# Run benchmark
python core/engine.py

# View results
cat data/results.json | jq

# Run tests
pytest tests/ -v --cov

# Start API
python -m uvicorn api:app --reload

# Check database
psql postgresql://benchmark_user:benchmark_pass@localhost:5432/benchmark_db

# View logs
tail -f logs/app.log

# Stop all services
docker-compose down

# View service status
docker-compose ps
```

---

## Next Steps

1. **Integrate Real APIs:** Update `fetch_llm_response()` in `core/engine.py`
2. **Customize Weights:** Modify scoring formula in `core/engine.py`
3. **Add User Roles:** Implement RBAC in `api.py`
4. **Deploy to Kubernetes:** Use manifests in `k8s/`
5. **Monitor SLA:** Setup Grafana alerts

---

**Happy Benchmarking! 🚀**
