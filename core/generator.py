"""
Synthetic Dataset Generator for LLM Benchmarks

This module generates synthetic datasets based on a specific domain
using a teacher model approach. Supports Finance, Aviation, and General Knowledge domains.
"""

import json
import random


def generate_synthetic_data(num_samples=50, domain="General Knowledge"):
    """
    Generate synthetic dataset based on a specific domain using teacher model approach.

    Args:
        num_samples: Number of samples to generate
        domain: Domain of questions (e.g., Finance, Aviation, General Knowledge)
    """
    topics = [
        "Data Science",
        "Cloud Computing",
        "LLM Architectures",
        "Big Data Pipelines",
    ]
    dataset = []

    for i in range(num_samples):
        topic = random.choice(topics)
        # In a real scenario, you'd call an API here to generate the question/answer
        entry = {
            "id": i + 1,
            "category": topic,
            "domain": domain,
            "prompt": f"Explain the core principles of {topic} in 50 words.",
            "ground_truth": f"This is the ideal answer for {topic} used for comparison...",
            "difficulty": random.choice(["Beginner", "Intermediate", "Advanced"]),
        }
        dataset.append(entry)

    # Ensure data directory exists
    import os

    os.makedirs("data", exist_ok=True)

    with open("data/synthetic_input.json", "w") as f:
        json.dump(dataset, f, indent=4)
    print(
        f"Successfully generated {num_samples} synthetic samples in domain: {domain}."
    )


if __name__ == "__main__":
    # Example usage: Generate synthetic data for different domains
    generate_synthetic_data(num_samples=50, domain="General Knowledge")
    # generate_synthetic_data(num_samples=50, domain="Finance")
    # generate_synthetic_data(num_samples=50, domain="Aviation")
