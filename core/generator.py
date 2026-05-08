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
