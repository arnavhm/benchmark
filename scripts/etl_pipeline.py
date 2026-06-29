import pandas as pd
import json
import os
import uuid
import random
from datetime import datetime
import sys
import logging

# Add backend directory to sys.path to import core modules
sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

from core.database import SessionLocal, BenchmarkResult, Model
from core.logger import get_logger

logger = get_logger(__name__)

RAW_DIR = "data_lake/raw"

def generate_raw_data():
    """Simulate raw telemetry data coming from different streaming sources."""
    os.makedirs(RAW_DIR, exist_ok=True)
    
    models = ["gpt-4-turbo", "gemini-1.5-pro", "claude-3-opus"]
    num_records = 1000
    
    latency_data = []
    accuracy_data = []
    
    logger.info("Generating simulated raw telemetry data...")
    for _ in range(num_records):
        req_id = str(uuid.uuid4())
        model = random.choice(models)
        
        # Introduce some missing/dirty data
        lat = random.uniform(200.0, 1500.0) if random.random() > 0.05 else None
        
        latency_data.append({
            "request_id": req_id,
            "model_name": model,
            "latency_ms": lat,
            "timestamp": datetime.utcnow().isoformat()
        })
        
        accuracy_data.append({
            "req_id": req_id, # intentionally different column name
            "is_correct": bool(random.random() > 0.3),
            "confidence_score": random.uniform(0.5, 0.99)
        })
        
    pd.DataFrame(latency_data).to_csv(f"{RAW_DIR}/latency.csv", index=False)
    with open(f"{RAW_DIR}/accuracy.json", "w") as f:
        json.dump(accuracy_data, f)
        
    logger.info(f"Generated {num_records} raw records in {RAW_DIR}/")

def run_etl_pipeline():
    """Run the Pandas ETL pipeline: Extract, Transform, Load."""
    logger.info("Starting Pandas ETL Pipeline...")
    
    # 1. EXTRACT
    df_lat = pd.read_csv(f"{RAW_DIR}/latency.csv")
    df_acc = pd.read_json(f"{RAW_DIR}/accuracy.json")
    
    # 2. TRANSFORM
    # 2a. Cleansing: drop rows with missing latency
    initial_len = len(df_lat)
    df_lat = df_lat.dropna(subset=['latency_ms'])
    logger.info(f"Cleansing: dropped {initial_len - len(df_lat)} rows with missing latency.")
    
    # 2b. Rename columns for join
    df_acc = df_acc.rename(columns={"req_id": "request_id"})
    
    # 2c. Join the two datasets
    df_joined = pd.merge(df_lat, df_acc, on="request_id", how="inner")
    logger.info(f"Joined datasets. Resulting shape: {df_joined.shape}")
    
    # 2d. Aggregate to get model-level statistics
    df_agg = df_joined.groupby("model_name").agg({
        "is_correct": "mean",  # accuracy percentage
        "latency_ms": "mean",  # avg latency
    }).reset_index()
    
    df_agg['accuracy'] = (df_agg['is_correct'] * 100).round(2)
    df_agg['latency_sec'] = (df_agg['latency_ms'] / 1000.0).round(3)
    
    # 3. LOAD
    db = SessionLocal()
    try:
        for _, row in df_agg.iterrows():
            model_name = row['model_name']
            
            # Upsert Model
            model = db.query(Model).filter_by(name=model_name).first()
            if not model:
                model = Model(name=model_name, provider="ETL_Pipeline")
                db.add(model)
                db.commit()
                db.refresh(model)
                
            # Insert BenchmarkResult
            # Calculate a synthetic final score
            final_score = row['accuracy'] - (row['latency_sec'] * 2.0)
            
            result = BenchmarkResult(
                model_id=model.id,
                model_name=model_name,
                accuracy=row['accuracy'],
                latency=row['latency_sec'],
                cost=0.01,
                accuracy_norm=row['accuracy'],
                latency_norm=100.0 - (row['latency_sec'] * 10),
                cost_norm=95.0,
                final_score=max(0.0, min(100.0, final_score)),
                tier="production" if final_score > 80 else "analysis",
                execution_time=row['latency_sec'] * 1000
            )
            db.add(result)
            
        db.commit()
        logger.info("Successfully loaded aggregated results into SQLite database.")
    except Exception as e:
        db.rollback()
        logger.error(f"ETL Load failed: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    generate_raw_data()
    run_etl_pipeline()
