#!/bin/bash

##############################################################################
# LLM Benchmark Project Setup Script
# This script restructures the project with the following layout:
# /core - Python modules
# /web - Web assets (HTML, CSS, JS)
# /data/results - Results storage
# /scripts - Utility scripts
##############################################################################

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   LLM Benchmark Project Restructuring${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

##############################################################################
# Step 1: Initialize Git Repository
##############################################################################
echo -e "${YELLOW}[1/6] Initializing Git repository...${NC}"
if [ ! -d .git ]; then
    git init
    echo -e "${GREEN}✓ Git repository initialized${NC}"
else
    echo -e "${GREEN}✓ Git repository already exists${NC}"
fi
echo

##############################################################################
# Step 2: Create Directory Structure
##############################################################################
echo -e "${YELLOW}[2/6] Creating directory structure...${NC}"

directories=("core" "web" "data/results" "scripts")

for dir in "${directories[@]}"; do
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
        echo -e "${GREEN}✓ Created directory: $dir${NC}"
    else
        echo -e "${GREEN}✓ Directory already exists: $dir${NC}"
    fi
done
echo

##############################################################################
# Step 3: Move Python Files to /core
##############################################################################
echo -e "${YELLOW}[3/6] Moving Python files to /core...${NC}"

py_files=$(find . -maxdepth 1 -name "*.py" -type f)
if [ -z "$py_files" ]; then
    echo -e "${YELLOW}⚠ No Python files found in root directory${NC}"
else
    while IFS= read -r file; do
        if [ -f "$file" ]; then
            filename=$(basename "$file")
            if [ ! -f "core/$filename" ]; then
                mv "$file" "core/"
                echo -e "${GREEN}✓ Moved: $filename → core/${NC}"
            else
                echo -e "${YELLOW}⚠ File already exists in core/: $filename (skipped)${NC}"
            fi
        fi
    done <<< "$py_files"
fi
echo

##############################################################################
# Step 4: Move Web Assets to /web
##############################################################################
echo -e "${YELLOW}[4/6] Moving web assets to /web...${NC}"

# Move HTML, CSS, JS files
for ext in html css js; do
    files=$(find . -maxdepth 1 -name "*.$ext" -type f)
    if [ ! -z "$files" ]; then
        while IFS= read -r file; do
            if [ -f "$file" ]; then
                filename=$(basename "$file")
                if [ ! -f "web/$filename" ]; then
                    mv "$file" "web/"
                    echo -e "${GREEN}✓ Moved: $filename → web/${NC}"
                else
                    echo -e "${YELLOW}⚠ File already exists in web/: $filename (skipped)${NC}"
                fi
            fi
        done <<< "$files"
    fi
done

# Move entire templates directory to web if it exists
if [ -d "templates" ]; then
    if [ ! -d "web/templates" ]; then
        mv "templates" "web/"
        echo -e "${GREEN}✓ Moved: templates/ → web/${NC}"
    else
        echo -e "${YELLOW}⚠ web/templates already exists (skipped)${NC}"
    fi
fi

# Move entire static directory to web if it exists
if [ -d "static" ]; then
    if [ ! -d "web/static" ]; then
        mv "static" "web/"
        echo -e "${GREEN}✓ Moved: static/ → web/${NC}"
    else
        echo -e "${YELLOW}⚠ web/static already exists (skipped)${NC}"
    fi
fi

# Move server.js to web if it exists
if [ -f "server.js" ]; then
    if [ ! -f "web/server.js" ]; then
        mv "server.js" "web/"
        echo -e "${GREEN}✓ Moved: server.js → web/${NC}"
    else
        echo -e "${YELLOW}⚠ web/server.js already exists (skipped)${NC}"
    fi
fi

echo

##############################################################################
# Step 5: Generate Boilerplate Python Files
##############################################################################
echo -e "${YELLOW}[5/6] Generating boilerplate Python files...${NC}"

# Generate generator.py
if [ ! -f "core/generator.py" ]; then
    cat > "core/generator.py" << 'EOF'
"""
Synthetic Dataset Generator for LLM Benchmarks

This module provides utilities for generating synthetic datasets
to evaluate LLM model performance across various metrics.
"""

import json
import random
import string
from datetime import datetime
from typing import Dict, List, Any, Optional


class SyntheticDatasetGenerator:
    """Generates synthetic datasets for LLM benchmarking."""

    def __init__(self, seed: Optional[int] = None):
        """
        Initialize the dataset generator.

        Args:
            seed: Random seed for reproducibility
        """
        if seed is not None:
            random.seed(seed)

    def generate_prompts(self, count: int, complexity: str = "medium") -> List[str]:
        """
        Generate synthetic prompts.

        Args:
            count: Number of prompts to generate
            complexity: Prompt complexity level (simple, medium, complex)

        Returns:
            List of generated prompts
        """
        simple_prompts = [
            "What is the capital of France?",
            "Explain photosynthesis in one sentence.",
            "List the planets in our solar system.",
        ]

        medium_prompts = [
            "Compare and contrast machine learning and deep learning.",
            "Describe the process of photosynthesis with technical detail.",
            "What are the main factors affecting climate change?",
        ]

        complex_prompts = [
            "Analyze the ethical implications of artificial intelligence in healthcare.",
            "Explain quantum entanglement and its potential applications.",
            "Discuss the trade-offs between model accuracy and interpretability.",
        ]

        prompt_pools = {
            "simple": simple_prompts,
            "medium": medium_prompts,
            "complex": complex_prompts,
        }

        pool = prompt_pools.get(complexity, medium_prompts)
        return [random.choice(pool) for _ in range(count)]

    def generate_responses(
        self, prompts: List[str], quality: str = "medium"
    ) -> List[str]:
        """
        Generate synthetic LLM responses.

        Args:
            prompts: List of prompts to respond to
            quality: Response quality level (poor, medium, excellent)

        Returns:
            List of generated responses
        """
        responses = []
        for prompt in prompts:
            if quality == "poor":
                response = "I don't know."
            elif quality == "excellent":
                response = f"Comprehensive response to '{prompt[:30]}...': [detailed technical explanation with citations and examples]"
            else:  # medium
                response = f"Based on the prompt, here's my response: [relevant information about the topic]"
            responses.append(response)

        return responses

    def generate_dataset(
        self,
        num_samples: int = 100,
        prompt_complexity: str = "medium",
        response_quality: str = "medium",
    ) -> Dict[str, Any]:
        """
        Generate a complete synthetic dataset.

        Args:
            num_samples: Number of samples to generate
            prompt_complexity: Complexity of prompts
            response_quality: Quality of responses

        Returns:
            Dictionary containing the synthetic dataset
        """
        prompts = self.generate_prompts(num_samples, prompt_complexity)
        responses = self.generate_responses(prompts, response_quality)

        dataset = {
            "metadata": {
                "created_at": datetime.now().isoformat(),
                "num_samples": num_samples,
                "prompt_complexity": prompt_complexity,
                "response_quality": response_quality,
            },
            "samples": [
                {"id": i, "prompt": prompt, "response": response}
                for i, (prompt, response) in enumerate(zip(prompts, responses))
            ],
        }

        return dataset

    def save_dataset(self, dataset: Dict[str, Any], filepath: str) -> None:
        """
        Save dataset to a JSON file.

        Args:
            dataset: Dataset dictionary
            filepath: Output file path
        """
        with open(filepath, "w") as f:
            json.dump(dataset, f, indent=2)
        print(f"Dataset saved to {filepath}")


if __name__ == "__main__":
    # Example usage
    generator = SyntheticDatasetGenerator(seed=42)
    dataset = generator.generate_dataset(
        num_samples=50, prompt_complexity="medium", response_quality="medium"
    )
    generator.save_dataset(dataset, "synthetic_dataset.json")
    print(f"Generated {len(dataset['samples'])} samples")
EOF
    echo -e "${GREEN}✓ Created: core/generator.py${NC}"
else
    echo -e "${YELLOW}⚠ core/generator.py already exists (skipped)${NC}"
fi

# Generate engine.py
if [ ! -f "core/engine.py" ]; then
    cat > "core/engine.py" << 'EOF'
"""
LLM Scoring Engine

This module calculates comprehensive LLM performance scores based on
accuracy, latency, and cost metrics.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
import json


@dataclass
class Metrics:
    """Data class for LLM performance metrics."""

    accuracy: float  # 0-100
    latency: float  # milliseconds
    cost: float  # dollars per 1K tokens


class ScoringEngine:
    """Calculates LLM performance scores based on multiple metrics."""

    # Weighting factors for metrics (should sum to 1.0)
    DEFAULT_WEIGHTS = {"accuracy": 0.5, "latency": 0.3, "cost": 0.2}

    # Benchmark ranges for normalization
    BENCHMARK_RANGES = {
        "accuracy": {"min": 50, "max": 100},  # 50-100%
        "latency": {"min": 100, "max": 5000},  # 100-5000ms
        "cost": {"min": 0.001, "max": 0.05},  # $0.001-$0.05 per 1K tokens
    }

    def __init__(
        self, weights: Optional[Dict[str, float]] = None, normalize: bool = True
    ):
        """
        Initialize the scoring engine.

        Args:
            weights: Custom weighting for metrics (default: equal emphasis)
            normalize: Whether to normalize scores to 0-100 range
        """
        self.weights = weights or self.DEFAULT_WEIGHTS
        self.normalize = normalize

        # Validate weights
        if abs(sum(self.weights.values()) - 1.0) > 0.01:
            raise ValueError("Weights must sum to approximately 1.0")

    def normalize_metric(self, metric: str, value: float) -> float:
        """
        Normalize a metric to 0-100 scale.

        Args:
            metric: Metric name (accuracy, latency, cost)
            value: Metric value

        Returns:
            Normalized value (0-100)
        """
        if metric not in self.BENCHMARK_RANGES:
            return value

        benchmark = self.BENCHMARK_RANGES[metric]
        min_val = benchmark["min"]
        max_val = benchmark["max"]

        # Clamp value within range
        value = max(min_val, min(max_val, value))

        if metric == "accuracy":
            # For accuracy, higher is better
            normalized = ((value - min_val) / (max_val - min_val)) * 100
        else:
            # For latency and cost, lower is better (invert)
            normalized = ((max_val - value) / (max_val - min_val)) * 100

        return max(0, min(100, normalized))

    def calculate_score(
        self, accuracy: float, latency: float, cost: float
    ) -> float:
        """
        Calculate composite LLM score.

        Args:
            accuracy: Accuracy percentage (0-100)
            latency: Response time in milliseconds
            cost: Cost per 1K tokens in dollars

        Returns:
            Composite score (0-100)
        """
        # Normalize individual metrics
        norm_accuracy = (
            self.normalize_metric("accuracy", accuracy) if self.normalize else accuracy
        )
        norm_latency = (
            self.normalize_metric("latency", latency) if self.normalize else latency
        )
        norm_cost = (
            self.normalize_metric("cost", cost) if self.normalize else cost
        )

        # Calculate weighted composite score
        score = (
            norm_accuracy * self.weights["accuracy"]
            + norm_latency * self.weights["latency"]
            + norm_cost * self.weights["cost"]
        )

        return round(score, 2)

    def calculate_scores(
        self, models: List[Dict[str, float]]
    ) -> List[Dict[str, float]]:
        """
        Calculate scores for multiple models.

        Args:
            models: List of dicts with 'name', 'accuracy', 'latency', 'cost'

        Returns:
            List of dicts with model scores
        """
        results = []
        for model in models:
            score = self.calculate_score(
                model["accuracy"], model["latency"], model["cost"]
            )
            results.append({**model, "score": score})

        # Sort by score (descending)
        results.sort(key=lambda x: x["score"], reverse=True)
        return results

    def generate_report(self, models: List[Dict[str, float]]) -> str:
        """
        Generate a formatted performance report.

        Args:
            models: List of model metrics

        Returns:
            Formatted report string
        """
        scored_models = self.calculate_scores(models)

        report = "LLM Benchmark Results\n"
        report += "=" * 60 + "\n\n"

        for idx, model in enumerate(scored_models, 1):
            report += f"{idx}. {model['name']}\n"
            report += f"   Accuracy:  {model['accuracy']:.1f}%\n"
            report += f"   Latency:   {model['latency']:.0f}ms\n"
            report += f"   Cost:      ${model['cost']:.4f}\n"
            report += f"   Score:     {model['score']:.2f}/100\n\n"

        return report


if __name__ == "__main__":
    # Example usage
    engine = ScoringEngine()

    test_models = [
        {"name": "GPT-4", "accuracy": 92, "latency": 850, "cost": 0.03},
        {"name": "Claude 3", "accuracy": 90, "latency": 720, "cost": 0.025},
        {"name": "Llama 2", "accuracy": 78, "latency": 450, "cost": 0.005},
    ]

    scores = engine.calculate_scores(test_models)
    print(engine.generate_report(test_models))
EOF
    echo -e "${GREEN}✓ Created: core/engine.py${NC}"
else
    echo -e "${YELLOW}⚠ core/engine.py already exists (skipped)${NC}"
fi

echo

##############################################################################
# Step 6: Create .gitignore
##############################################################################
echo -e "${YELLOW}[6/6] Creating .gitignore...${NC}"

if [ ! -f .gitignore ]; then
    cat > .gitignore << 'EOF'
# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
pip-wheel-metadata/
share/python-wheels/
*.egg-info/
.installed.cfg
*.egg
MANIFEST
venv/
ENV/
env/
.venv/

# Virtual environments
.env
.venv
venv/
ENV/
env/

# IDE
.vscode/
.idea/
*.swp
*.swo
*~
.DS_Store
*.sublime-project
*.sublime-workspace

# Data & Results
data/results/**/*.json
data/results/**/*.csv
*.log
*.tmp

# Large datasets
*.parquet
*.feather
*.pkl
*.pickle

# Node/Web
node_modules/
npm-debug.log*
yarn-error.log*
.next/
out/
.nuxt/
dist/

# OS
.DS_Store
Thumbs.db
*.swp
*.swo
*~

# Testing
.pytest_cache/
.coverage
htmlcov/
.tox/

# Project specific
model_responses.json
*.cache
.env.local
.env.*.local
EOF
    echo -e "${GREEN}✓ Created: .gitignore${NC}"
else
    echo -e "${YELLOW}⚠ .gitignore already exists (skipped)${NC}"
fi
echo

##############################################################################
# Step 7: Perform Initial Git Commit
##############################################################################
echo -e "${YELLOW}[7/6] Performing initial git commit...${NC}"

git add .
git commit -m "System Architecture Redesign" --quiet 2>/dev/null || {
    echo -e "${YELLOW}⚠ No changes to commit (repository may already be initialized)${NC}"
}

echo -e "${GREEN}✓ Git commit completed${NC}"
echo

##############################################################################
# Summary
##############################################################################
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Project restructuring completed successfully!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

echo -e "${BLUE}Project Structure:${NC}"
echo -e "  📁 /core              - Python modules (generator.py, engine.py, etc.)"
echo -e "  📁 /web               - Web assets (HTML, CSS, JS, templates, static)"
echo -e "  📁 /data/results      - Benchmark results"
echo -e "  📁 /scripts           - Utility scripts"
echo -e "  📄 .gitignore         - Git ignore rules"
echo

echo -e "${BLUE}Generated Files:${NC}"
echo -e "  📜 core/generator.py  - Synthetic dataset generator"
echo -e "  📜 core/engine.py     - LLM scoring engine"
echo

echo -e "${BLUE}Next Steps:${NC}"
echo -e "  1. Review the generated boilerplate files"
echo -e "  2. Update core/generator.py with your dataset logic"
echo -e "  3. Update core/engine.py with your scoring metrics"
echo -e "  4. Configure web/server.js for your backend service"
echo -e "  5. Run 'git log' to verify your initial commit"
echo
