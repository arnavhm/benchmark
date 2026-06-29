import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import logging

logger = logging.getLogger(__name__)

class NLPEvaluator:
    """
    Evaluates semantic similarity between generated text and ground truth
    using TF-IDF (Term Frequency-Inverse Document Frequency) and cosine similarity.
    """
    def __init__(self):
        # We use standard English stop words to ignore common words (the, is, at, which, etc.)
        self.vectorizer = TfidfVectorizer(stop_words='english')

    def calculate_similarity(self, predicted: str, ground_truth: str) -> float:
        """
        Calculates the cosine similarity between the predicted text and ground truth.
        Returns a float between 0.0 and 1.0.
        """
        if not predicted or not ground_truth:
            return 0.0

        try:
            # Fit and transform the corpus (just the two texts)
            tfidf_matrix = self.vectorizer.fit_transform([ground_truth, predicted])
            
            # tfidf_matrix is of shape (2, n_features). 
            # cosine_similarity computes similarity of all pairs, so we get a 2x2 matrix.
            # The cross similarity is at [0, 1] (or [1, 0]).
            similarity = cosine_similarity(tfidf_matrix[0:1], tfidf_matrix[1:2])[0][0]
            
            # Ensure the value is properly bounded
            return float(max(0.0, min(1.0, similarity)))
        except Exception as e:
            logger.error(f"Error calculating NLP similarity: {e}")
            return 0.0

# Singleton instance for easy importing
nlp_evaluator = NLPEvaluator()
