#!/bin/bash

# Ensure logs directory exists
mkdir -p logs

echo "🧹 Cleaning up any old servers on ports 5002 and 8000..."
# Kill any processes running on the ports to prevent address-in-use errors
lsof -ti :5002 | xargs kill -9 2>/dev/null
lsof -ti :8000 | xargs kill -9 2>/dev/null

echo "🚀 Starting Node.js Web Dashboard on http://127.0.0.1:5002..."
node web/server.js > logs/node_server.log 2>&1 &
NODE_PID=$!

echo "🚀 Starting FastAPI Backend on http://127.0.0.1:8000..."
PYTHONPATH=. .venv/bin/python -m uvicorn api:app --port 8000 > logs/fastapi_server.log 2>&1 &
API_PID=$!

# Wait briefly to confirm start
sleep 2

# Check if processes are running
if kill -0 $NODE_PID 2>/dev/null && kill -0 $API_PID 2>/dev/null; then
    echo "=========================================================="
    echo "🎉 Both servers launched successfully in the background!"
    echo "=========================================================="
    echo "💻 Node Web Dashboard: http://127.0.0.1:5002"
    echo "⚙️ FastAPI Swagger Docs: http://127.0.0.1:8000/docs"
    echo "⚙️ FastAPI Health: http://127.0.0.1:8000/health"
    echo "=========================================================="
    echo "To monitor logs in real-time, run:"
    echo "  tail -f logs/node_server.log"
    echo "  tail -f logs/fastapi_server.log"
else
    echo "⚠️ One of the servers failed to start. Check the logs under the 'logs/' folder."
fi
