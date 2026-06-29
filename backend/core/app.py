"""
AI Model Benchmark Analyzer - Backend
Flask application serving benchmark data, model recommendations,
custom benchmark analysis, and optional real-time Gemini API evaluation.
"""

import os
import json
import time
import hashlib
import random
from pathlib import Path

from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
import pandas as pd

# ─── Optional: load python-dotenv if installed ────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()  # Reads .env file into os.environ
except ImportError:
    pass  # dotenv not installed — rely on system env vars

# ─── Optional: Google Gemini SDK (new google-genai package) ─────────────────
try:
    from google import genai as google_genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False

app = Flask(__name__)
CORS(app)

# ─── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR        = Path(__file__).parent
DATA_PATH       = BASE_DIR / "data.csv"
DATASET_PATH    = BASE_DIR / "custom_dataset.json"
RESPONSES_PATH  = BASE_DIR / "model_responses.json"
CACHE_PATH      = BASE_DIR / "api_response_cache.json"
MODELS_JSON_PATH = BASE_DIR / "data" / "models.json"
SCORE_CATEGORIES = ["coding", "math", "reasoning", "chat"]

# ─── Load Standard Benchmark CSV ─────────────────────────────────────────────
df = pd.read_csv(DATA_PATH)

# ─── Load Custom Dataset ──────────────────────────────────────────────────────
with open(DATASET_PATH, "r") as f:
    CUSTOM_DATASET = json.load(f)

# ─── Load Simulated Model Responses ──────────────────────────────────────────
with open(RESPONSES_PATH, "r") as f:
    MODEL_RESPONSES = json.load(f)

# ─── Task-to-Benchmark Mapping ────────────────────────────────────────────────
TASK_BENCHMARK_MAP = {
    "Coding": {
        "primary": "HumanEval",
        "secondary": ["GSM8K"],
        "description": "Code generation, debugging, and software engineering tasks",
        "icon": "💻",
    },
    "Math": {
        "primary": "GSM8K",
        "secondary": ["MMLU"],
        "description": "Mathematical reasoning, problem solving, and calculations",
        "icon": "🧮",
    },
    "Research": {
        "primary": "MMLU",
        "secondary": ["HellaSwag", "GSM8K"],
        "description": "Knowledge retrieval, analysis, and academic research",
        "icon": "🔬",
    },
    "Chatbot": {
        "primary": "HellaSwag",
        "secondary": ["MMLU"],
        "description": "Conversational AI, customer support, and general chat",
        "icon": "🤖",
    },
}

BENCHMARK_LABELS = {
    "MMLU": "knowledge",
    "GSM8K": "math",
    "HumanEval": "coding",
    "HellaSwag": "reasoning",
}

# ─── Model Metadata ───────────────────────────────────────────────────────────
MODEL_INFO = {
    "GPT-4": {
        "provider": "OpenAI",
        "description": "Flagship multimodal model with strong reasoning capabilities across all domains.",
        "strengths": ["Broad knowledge", "Complex reasoning", "Multimodal"],
        "color": "#10a37f",
    },
    "GPT-4o": {
        "provider": "OpenAI",
        "description": "Optimized variant of GPT-4 with faster inference and improved benchmark scores.",
        "strengths": ["Speed", "Coding", "Math reasoning"],
        "color": "#0ea47a",
    },
    "Claude-3": {
        "provider": "Anthropic",
        "description": "Safety-focused model excelling in nuanced understanding and helpfulness.",
        "strengths": ["Safety", "Long context", "Nuanced reasoning"],
        "color": "#d4a574",
    },
    "Claude-3.5": {
        "provider": "Anthropic",
        "description": "Upgraded Claude with improved coding and analytical capabilities.",
        "strengths": ["Coding", "Analysis", "Instruction following"],
        "color": "#c4956a",
    },
    "Gemini": {
        "provider": "Google",
        "description": "Google's flagship model with strong multimodal and reasoning capabilities.",
        "strengths": ["Multimodal", "Reasoning", "Integration"],
        "color": "#4285f4",
    },
    "Gemini-1.5": {
        "provider": "Google",
        "description": "Enhanced Gemini with extended context window and improved performance.",
        "strengths": ["Long context", "Multimodal", "Efficiency"],
        "color": "#3b78e7",
    },
    "Llama-2": {
        "provider": "Meta",
        "description": "Open-source model suitable for customization and on-premise deployment.",
        "strengths": ["Open source", "Customizable", "Cost effective"],
        "color": "#0668E1",
    },
    "Mistral-Large": {
        "provider": "Mistral AI",
        "description": "European AI model with strong multilingual and reasoning capabilities.",
        "strengths": ["Multilingual", "Efficiency", "Open weights"],
        "color": "#ff7000",
    },
}


def _load_dynamic_models():
    """Load the dynamic Node-compatible model dataset used by the frontend."""
    if MODELS_JSON_PATH.exists():
        with open(MODELS_JSON_PATH, "r") as f:
            payload = json.load(f)
        return {
            "source": payload.get("source", "local-json"),
            "lastUpdated": payload.get("lastUpdated"),
            "models": payload.get("models", []),
        }

    # Fallback for older checkouts: convert the legacy CSV into the new shape.
    legacy_models = []
    for _, row in df.iterrows():
        legacy_models.append({
            "name": row["model"],
            "provider": MODEL_INFO.get(row["model"], {}).get("provider", "Unknown"),
            "coding": float(row["HumanEval"]),
            "math": float(row["GSM8K"]),
            "reasoning": float(row["HellaSwag"]),
            "chat": float(row["MMLU"]),
            "bestUseCase": MODEL_INFO.get(row["model"], {}).get("description", ""),
        })
    return {
        "source": "legacy-csv",
        "lastUpdated": None,
        "models": legacy_models,
    }


def _normalize_dynamic_weights(weights):
    values = {
        category: max(0.0, float((weights or {}).get(category, 0)))
        for category in SCORE_CATEGORIES
    }
    total = sum(values.values())
    if total == 0:
        return {category: 1 / len(SCORE_CATEGORIES) for category in SCORE_CATEGORIES}
    return {category: value / total for category, value in values.items()}


def _best_category(model):
    return max(SCORE_CATEGORIES, key=lambda category: float(model.get(category, 0)))


def _weakest_category(model):
    return min(SCORE_CATEGORIES, key=lambda category: float(model.get(category, 0)))


def _dynamic_stats(models):
    stats = {}
    for category in SCORE_CATEGORIES:
        values = [float(model.get(category, 0)) for model in models]
        leader = max(models, key=lambda model: float(model.get(category, 0)))
        stats[category] = {
            "max": round(max(values), 1),
            "min": round(min(values), 1),
            "avg": round(sum(values) / len(values), 1),
            "leader": leader.get("name", "Unknown"),
        }
    return stats


def _rank_dynamic_models(models, weights, sort_by="score", filter_category="all"):
    normalized = _normalize_dynamic_weights(weights)
    ranked = []

    for model in models:
        final_score = sum(
            float(model.get(category, 0)) * normalized[category]
            for category in SCORE_CATEGORIES
        )
        best_category = _best_category(model)
        ranked.append({
            "model": model.get("name"),
            "name": model.get("name"),
            "provider": model.get("provider", "Unknown"),
            "coding": float(model.get("coding", 0)),
            "math": float(model.get("math", 0)),
            "reasoning": float(model.get("reasoning", 0)),
            "chat": float(model.get("chat", 0)),
            "finalScore": round(final_score, 2),
            "weighted_score": round(final_score, 2),
            "bestCategory": best_category,
            "bestUseCase": model.get("bestUseCase", ""),
            "strengths": [best_category, "balanced ranking fit"],
        })

    if filter_category != "all":
        ranked = [
            model for model in ranked
            if model.get("bestCategory") == filter_category
        ]

    if sort_by in SCORE_CATEGORIES:
        ranked.sort(key=lambda model: model[sort_by], reverse=True)
    elif sort_by == "name":
        ranked.sort(key=lambda model: model["model"])
    else:
        ranked.sort(key=lambda model: model["finalScore"], reverse=True)

    for index, model in enumerate(ranked):
        model["rank"] = index + 1
        model["analysis"] = _dynamic_reasoning(model, ranked, normalized)
    return ranked


def _dynamic_reasoning(model, ranked, normalized_weights):
    best_category = max(SCORE_CATEGORIES, key=lambda category: model[category])
    weakest_category = min(SCORE_CATEGORIES, key=lambda category: model[category])
    weighted_focus = max(SCORE_CATEGORIES, key=lambda category: normalized_weights[category])
    runner_up = ranked[1] if model.get("rank") == 1 and len(ranked) > 1 else ranked[0] if ranked and ranked[0] != model else None
    comparison = ""
    if runner_up:
        direction = "ahead of" if model["finalScore"] >= runner_up["finalScore"] else "behind"
        comparison = (
            f"It is {abs(model['finalScore'] - runner_up['finalScore']):.1f} points "
            f"{direction} {runner_up['model']} under the current weights."
        )

    summary = (
        f"{model['model']} ranks #{model.get('rank', 1)} because it combines strong "
        f"{best_category} performance with a weighted score of {model['finalScore']:.1f}. "
        f"{comparison}"
    ).strip()
    return {
        "rank": model.get("rank", 1),
        "model": model["model"],
        "summary": summary,
        "reasoning": summary,
        "strengths": [
            f"{best_category} is its strongest category at {model[best_category]:.1f}.",
            f"It aligns well with the current {weighted_focus} weighting.",
        ],
        "weaknesses": [
            f"{weakest_category} is its lowest category at {model[weakest_category]:.1f}."
        ],
        "bestUseCase": model.get("bestUseCase", ""),
        "tradeOff": (
            f"Choose carefully for {weakest_category}-first workflows where another "
            "model may be more specialized."
        ),
    }


def _dynamic_insights(ranked):
    if not ranked:
        return []
    top = ranked[0]
    weakest = min(ranked, key=lambda model: model["finalScore"])
    category_leaders = []
    for category in SCORE_CATEGORIES[:2]:
        leader = max(ranked, key=lambda model: model[category])
        category_leaders.append({
            "icon": "🏅",
            "title": f"{leader['model']} leads {category}",
            "body": f"{leader['model']} posts the strongest {category} score at {leader[category]:.1f}.",
            "accent": "#00cec9" if category == "coding" else "#fd79a8",
        })

    return [
        {
            "icon": "🧠",
            "title": f"Why {top['model']} ranks #1",
            "body": top["analysis"]["summary"],
            "accent": "#6c5ce7",
        },
        *category_leaders,
        {
            "icon": "⚠️",
            "title": f"{weakest['model']} is weakest in this view",
            "body": (
                f"{weakest['model']} has the lowest computed score at "
                f"{weakest['finalScore']:.1f} with the current weights and filters."
            ),
            "accent": "#fdcb6e",
        },
    ]

# ─── Custom benchmark models list ─────────────────────────────────────────────
CUSTOM_MODELS = ["GPT-4", "Claude-3", "Gemini", "Llama-2"]

# ─── Gemini API setup (google-genai SDK) ────────────────────────────────────
gemini_client = None
if GEMINI_AVAILABLE:
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if api_key and api_key != "your_gemini_api_key_here":
        try:
            gemini_client = google_genai.Client(api_key=api_key)
            print("[Gemini] API configured successfully.")
        except Exception as e:
            print(f"[Gemini] Configuration failed: {e}")
    else:
        print("[Gemini] No valid API key found. Running in simulated mode only.")

# ─── Response Cache (disk-based) ──────────────────────────────────────────────
def _load_cache():
    """Load the disk-based API response cache."""
    if CACHE_PATH.exists():
        try:
            with open(CACHE_PATH, "r") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def _save_cache(cache):
    """Persist cache to disk."""
    try:
        with open(CACHE_PATH, "w") as f:
            json.dump(cache, f, indent=2)
    except Exception as e:
        print(f"[Cache] Failed to save: {e}")

def _cache_key(question: str) -> str:
    """Deterministic cache key from question text."""
    return hashlib.md5(question.strip().lower().encode()).hexdigest()


# ═══════════════════════════════════════════════════════════════════════════════
# Scoring Logic
# ═══════════════════════════════════════════════════════════════════════════════

def compute_accuracy(expected: str, response: str) -> float:
    """
    Accuracy Score:
    Returns 1.0 if the expected answer (or its key parts) appear in the response,
    0.0 otherwise. Case-insensitive.
    """
    expected_lower  = expected.lower().strip()
    response_lower  = response.lower().strip()
    return 1.0 if expected_lower in response_lower else 0.0


def compute_relevance(keywords: list, response: str) -> float:
    """
    Relevance Score (0–5):
    Counts how many keywords from the question's keyword list appear in the response.
    Score = min(5, matches * (5 / total_keywords))
    """
    if not keywords:
        return 2.5  # neutral if no keywords defined
    response_lower = response.lower()
    matches = sum(1 for kw in keywords if kw.lower() in response_lower)
    score = (matches / len(keywords)) * 5
    return round(min(5.0, score), 2)


def compute_final_score(accuracy: float, relevance: float) -> float:
    """
    Final Score = accuracy * 0.7 + (relevance / 5) * 0.3
    Normalises relevance (0–5) to 0–1 before weighting.
    """
    return round(accuracy * 0.7 + (relevance / 5.0) * 0.3, 4)


def _model_average(row) -> float:
    """Average the standard benchmark columns for a model row."""
    benchmarks = list(BENCHMARK_LABELS.keys())
    return round(sum(float(row[bench]) for bench in benchmarks) / len(benchmarks), 2)


def generate_benchmark_insights() -> list:
    """Create dashboard insights from the standard benchmark table."""
    insights = []
    benchmarks = list(BENCHMARK_LABELS.keys())
    category_leaders = []

    for bench in benchmarks:
        sorted_rows = df.sort_values(bench, ascending=False).reset_index(drop=True)
        leader = sorted_rows.iloc[0]
        runner_up = sorted_rows.iloc[1]
        gap = round(float(leader[bench]) - float(runner_up[bench]), 1)
        category = BENCHMARK_LABELS[bench]
        category_leaders.append({
            "bench": bench,
            "category": category,
            "model": leader["model"],
            "score": float(leader[bench]),
            "runner_up": runner_up["model"],
            "gap": gap,
        })

    leader_summary = "; ".join(
        f"{item['model']} leads {item['category']} by {item['gap']:.1f}"
        for item in category_leaders
    )
    lead_model = category_leaders[0]["model"]
    insights.append({
        "icon": "🏅",
        "title": "Category leaders",
        "body": f"Best performers by category: {leader_summary}.",
        "accent": MODEL_INFO.get(lead_model, {}).get("color", "#6c5ce7"),
    })

    averaged = [
        {"model": row["model"], "average": _model_average(row)}
        for _, row in df.iterrows()
    ]
    strongest = max(averaged, key=lambda item: item["average"])
    insights.append({
        "icon": "📈",
        "title": f"{strongest['model']} is strongest overall",
        "body": (
            f"{strongest['model']} has the highest average benchmark score at "
            f"{strongest['average']:.1f}, making it the most balanced broad-use option."
        ),
        "accent": MODEL_INFO.get(strongest["model"], {}).get("color", "#00cec9"),
    })

    largest_gap = None
    for bench in benchmarks:
        sorted_rows = df.sort_values(bench, ascending=False).reset_index(drop=True)
        top = sorted_rows.iloc[0]
        bottom = sorted_rows.iloc[-1]
        gap = round(float(top[bench]) - float(bottom[bench]), 1)
        if largest_gap is None or gap > largest_gap["gap"]:
            largest_gap = {
                "bench": bench,
                "category": BENCHMARK_LABELS[bench],
                "top_model": top["model"],
                "bottom_model": bottom["model"],
                "gap": gap,
                "accent": MODEL_INFO.get(top["model"], {}).get("color", "#fd79a8"),
            }

    if largest_gap:
        insights.append({
            "icon": "↕️",
            "title": "Biggest performance gap",
            "body": (
                f"{largest_gap['category'].capitalize()} has the widest spread: "
                f"{largest_gap['top_model']} leads {largest_gap['bottom_model']} "
                f"by {largest_gap['gap']:.1f} points on {largest_gap['bench']}."
            ),
            "accent": largest_gap["accent"],
        })

    weakest = min(averaged, key=lambda item: item["average"])
    insights.append({
        "icon": "⚠️",
        "title": f"{weakest['model']} is weakest overall",
        "body": (
            f"{weakest['model']} has the lowest average benchmark score at "
            f"{weakest['average']:.1f}, suggesting limited fit for broad workloads."
        ),
        "accent": MODEL_INFO.get(weakest["model"], {}).get("color", "#e17055"),
    })

    closest = min(category_leaders, key=lambda item: item["gap"])
    insights.append({
        "icon": "⚖️",
        "title": f"Tightest race: {closest['category']}",
        "body": (
            f"{closest['model']} only leads {closest['runner_up']} by "
            f"{closest['gap']:.1f} points on {closest['bench']}, so this category is highly competitive."
        ),
        "accent": MODEL_INFO.get(closest["model"], {}).get("color", "#fdcb6e"),
    })

    return insights[:5]


def generate_reasoning_explanation(best: dict, rankings: list, weights: dict) -> dict:
    """Explain why the weighted recommendation won, including trade-offs."""
    runner_up = rankings[1] if len(rankings) > 1 else None
    all_scores = best["all_scores"]
    ordered_strengths = sorted(all_scores.items(), key=lambda item: item[1], reverse=True)
    top_bench, top_score = ordered_strengths[0]
    second_bench, second_score = ordered_strengths[1]

    category_strengths = [
        f"{BENCHMARK_LABELS[top_bench]} ({top_bench}: {top_score:.1f})",
        f"{BENCHMARK_LABELS[second_bench]} ({second_bench}: {second_score:.1f})",
    ]

    comparison = ""
    if runner_up:
        leading_categories = [
            BENCHMARK_LABELS[bench]
            for bench, score in all_scores.items()
            if score > runner_up["all_scores"][bench]
        ]
        trailing_categories = [
            BENCHMARK_LABELS[bench]
            for bench, score in all_scores.items()
            if score < runner_up["all_scores"][bench]
        ]
        score_gap = best["weighted_score"] - runner_up["weighted_score"]
        if leading_categories:
            comparison = (
                f"It outperforms {runner_up['model']} in "
                f"{', '.join(leading_categories[:3])}"
            )
            if trailing_categories:
                comparison += f", while trailing in {', '.join(trailing_categories[:2])}"
            comparison += f", for a weighted lead of {score_gap:.1f} points."
        else:
            comparison = (
                f"It edges {runner_up['model']} by {score_gap:.1f} weighted points "
                "because the selected weights favor its strongest categories."
            )

    weighted_focus = max(weights, key=weights.get)
    weakest_bench, weakest_score = ordered_strengths[-1]
    trade_off = (
        f"The main trade-off is {BENCHMARK_LABELS[weakest_bench]} "
        f"({weakest_bench}: {weakest_score:.1f}), so it may be less dominant when that "
        "capability matters more than the current weighting."
    )

    summary_parts = [
        (
            f"{best['model']} is recommended because it has the highest weighted score "
            f"and strong {category_strengths[0]} performance."
        ),
        comparison,
        (
            f"Its selection is especially aligned with the current {weighted_focus} "
            "weighting while still staying competitive across the benchmark set."
        ),
        trade_off,
    ]
    summary = " ".join(part for part in summary_parts if part)

    return {
        "summary": summary,
        "category_strengths": category_strengths,
        "comparison": comparison,
        "trade_off": trade_off,
    }


def evaluate_response(question_obj: dict, response_text: str) -> dict:
    """Evaluate a single model response against a question object."""
    expected = question_obj.get("expected_answer", "")
    keywords = question_obj.get("keywords", [])

    accuracy  = compute_accuracy(expected, response_text)
    relevance = compute_relevance(keywords, response_text)
    final     = compute_final_score(accuracy, relevance)

    return {
        "accuracy":  accuracy,
        "relevance": relevance,
        "final":     final,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Gemini API Call (with caching and fallback)
# ═══════════════════════════════════════════════════════════════════════════════

def get_gemini_response(question: str, use_cache: bool = True) -> dict:
    """
    Call the Gemini API for a response using the google-genai SDK.
    Returns: { "text": str, "source": "api"|"cache"|"error", "response_time": float }
    Falls back gracefully on failure.
    """
    ck = _cache_key(question)
    cache = _load_cache()

    # Return cached result if available
    if use_cache and ck in cache:
        return {"text": cache[ck]["text"], "source": "cache", "response_time": cache[ck].get("response_time", 0)}

    if gemini_client is None:
        return {"text": "", "source": "error", "response_time": 0}

    try:
        # Add a small delay to respect rate limits
        time.sleep(0.5)
        start = time.time()
        response = gemini_client.models.generate_content(
            model="gemini-2.0-flash",
            contents=question,
        )
        elapsed = round(time.time() - start, 3)
        text = response.text.strip() if response.text else ""

        # Cache the result
        cache[ck] = {"text": text, "response_time": elapsed}
        _save_cache(cache)

        return {"text": text, "source": "api", "response_time": elapsed}

    except Exception as e:
        print(f"[Gemini] API error for question '{question[:60]}...': {e}")
        return {"text": "", "source": "error", "response_time": 0}


# ═══════════════════════════════════════════════════════════════════════════════
# Recommendation System
# ═══════════════════════════════════════════════════════════════════════════════

def generate_recommendation(model_scores: dict, category_scores: dict) -> dict:
    """
    Recommend the best model based on custom benchmark scores.
    Returns recommendation dict with explanation.
    """
    if not model_scores:
        return {}

    # Find best model by overall score
    best_model = max(model_scores, key=lambda m: model_scores[m]["overall"])
    best_score = model_scores[best_model]["overall"]

    # Find top categories for the best model
    best_cats = category_scores.get(best_model, {})
    top_categories = sorted(best_cats.items(), key=lambda x: x[1], reverse=True)[:2]
    top_cat_names = [cat.capitalize() for cat, _ in top_categories if _ > 0]

    if top_cat_names:
        cat_str = " and ".join(top_cat_names)
        explanation = (
            f"{best_model} is recommended because it achieved the highest overall score "
            f"({best_score:.1%}) on the custom benchmark, excelling particularly in "
            f"{cat_str} tasks."
        )
    else:
        explanation = (
            f"{best_model} is recommended with the highest overall custom benchmark score "
            f"of {best_score:.1%}."
        )

    # Runner-up
    sorted_models = sorted(model_scores.items(), key=lambda x: x[1]["overall"], reverse=True)
    runner_up = sorted_models[1][0] if len(sorted_models) > 1 else None
    if runner_up:
        gap = best_score - model_scores[runner_up]["overall"]
        explanation += f" It leads {runner_up} by {gap:.1%}."

    return {
        "recommended_model": best_model,
        "score": round(best_score * 100, 2),
        "explanation": explanation,
        "rankings": [
            {
                "model": m,
                "overall": round(s["overall"] * 100, 2),
                "color": MODEL_INFO.get(m, {}).get("color", "#6c5ce7"),
                "provider": MODEL_INFO.get(m, {}).get("provider", "Unknown"),
            }
            for m, s in sorted_models
        ],
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Routes — Standard Dashboard
# ═══════════════════════════════════════════════════════════════════════════════

@app.route("/")
def index():
    """Serve the main dashboard page."""
    return render_template("index.html")


@app.route("/get-data")
def get_data():
    """Return dynamic benchmark data as JSON. Used by the frontend charts."""
    payload = _load_dynamic_models()
    raw_models = payload["models"]
    data = [
        {
            "model": model.get("name"),
            "provider": model.get("provider", "Unknown"),
            "coding": model.get("coding", 0),
            "math": model.get("math", 0),
            "reasoning": model.get("reasoning", 0),
            "chat": model.get("chat", 0),
            "bestUseCase": model.get("bestUseCase", ""),
        }
        for model in raw_models
    ]
    ranked = _rank_dynamic_models(raw_models, {
        "coding": 25,
        "math": 25,
        "reasoning": 25,
        "chat": 25,
    })

    return jsonify({
        "models":     [model.get("name") for model in raw_models],
        "data":       data,
        "benchmarks": SCORE_CATEGORIES,
        "stats":      _dynamic_stats(raw_models),
        "insights":   _dynamic_insights(ranked),
        "lastUpdated": payload.get("lastUpdated"),
        "source":     payload.get("source"),
    })


@app.route("/recommend", methods=["POST"])
def recommend():
    """
    Recommend best model based on dynamic weighted scores.
    Accepts JSON: { weights: { coding, math, reasoning, chat }, sortBy, filterCategory }
    """
    payload = request.get_json() or {}
    weights = payload.get("weights", {
        "coding": 25,
        "math": 25,
        "reasoning": 25,
        "chat": 25,
    })
    sort_by = payload.get("sortBy", "score")
    filter_category = payload.get("filterCategory", "all")
    model_payload = _load_dynamic_models()
    results = _rank_dynamic_models(
        model_payload["models"],
        weights,
        sort_by=sort_by,
        filter_category=filter_category,
    )

    if not results:
        return jsonify({
            "rankings": [],
            "best_model": None,
            "explanation": "No models matched the selected filter.",
            "reasoning": None,
            "weights_used": weights,
            "insights": [],
            "lastUpdated": model_payload.get("lastUpdated"),
            "source": model_payload.get("source"),
        })

    best = results[0]
    runner_up = results[1] if len(results) > 1 else None
    gap = best["weighted_score"] - runner_up["weighted_score"] if runner_up else 0
    explanation = (
        f"{best['model']} is recommended with a computed score of "
        f"{best['weighted_score']:.1f}"
    )
    if runner_up:
        explanation += f", leading {runner_up['model']} by {gap:.1f} points"
    explanation += "."

    return jsonify({
        "rankings":          results,
        "best_model":        best["model"],
        "explanation":       explanation,
        "reasoning":         best.get("analysis"),
        "weights_used":      weights,
        "insights":          _dynamic_insights(results),
        "lastUpdated":       model_payload.get("lastUpdated"),
        "source":            model_payload.get("source"),
    })


# ═══════════════════════════════════════════════════════════════════════════════
# Routes — Custom Benchmark
# ═══════════════════════════════════════════════════════════════════════════════

@app.route("/run-custom-benchmark", methods=["POST"])
def run_custom_benchmark():
    """
    Run the custom benchmark analysis.

    Request JSON:
      {
        "mode":       "simulated" | "real_api",
        "difficulty": "all" | "easy" | "medium" | "hard",
        "categories": ["coding", "math", "reasoning", "chat"]  // optional filter
      }

    Returns per-model and per-category scores, visualisation data, and recommendation.
    """
    payload    = request.get_json() or {}
    mode       = payload.get("mode", "simulated")           # "simulated" or "real_api"
    difficulty = payload.get("difficulty", "all")            # filter by difficulty
    categories = payload.get("categories", ["coding", "math", "reasoning", "chat"])

    # ── Filter dataset ────────────────────────────────────────────────────────
    questions = [
        q for q in CUSTOM_DATASET
        if q["task"] in categories
        and (difficulty == "all" or q["difficulty"] == difficulty)
    ]

    if not questions:
        return jsonify({"error": "No questions match the selected filters."}), 400

    # ── Per-model evaluation ──────────────────────────────────────────────────
    results         = {}   # { model: { "detail": [...], "category": {...}, "overall": float } }
    gemini_api_used = False
    fallback_count  = 0

    for model in CUSTOM_MODELS:
        detail_rows    = []
        cat_scores     = {cat: [] for cat in categories}
        model_sim      = MODEL_RESPONSES.get(model, {})

        for q in questions:
            qid  = str(q["id"])
            task = q["task"]
            response_text = ""
            source        = "simulated"
            resp_time     = 0.0

            # ── Choose response source ────────────────────────────────────────
            if mode == "real_api" and model == "Gemini" and gemini_client is not None:
                # Use the live Gemini API for the "Gemini" model slot
                api_result    = get_gemini_response(q["question"])
                response_text = api_result["text"]
                source        = api_result["source"]
                resp_time     = api_result["response_time"]

                if source == "api":
                    gemini_api_used = True
                elif source == "cache":
                    gemini_api_used = True  # cached from a previous API call
                else:
                    # API failed — fall back to simulated
                    fallback_count += 1
                    response_text = model_sim.get(task, {}).get(qid, {}).get("response", "")
                    resp_time     = model_sim.get(task, {}).get(qid, {}).get("response_time", random.uniform(0.5, 2.0))
                    source        = "simulated_fallback"
            else:
                # Simulated mode (or non-Gemini model in real_api mode)
                response_text = model_sim.get(task, {}).get(qid, {}).get("response", "")
                resp_time     = model_sim.get(task, {}).get(qid, {}).get("response_time", random.uniform(0.5, 2.0))
                source        = "simulated"

            # ── Score the response ────────────────────────────────────────────
            scores = evaluate_response(q, response_text)

            row = {
                "id":              q["id"],
                "task":            task,
                "difficulty":      q["difficulty"],
                "question":        q["question"],
                "expected_answer": q["expected_answer"],
                "response":        response_text[:300],   # truncate for payload size
                "accuracy":        scores["accuracy"],
                "relevance":       round(scores["relevance"], 2),
                "final_score":     scores["final"],
                "response_time":   round(resp_time, 3),
                "source":          source,
            }
            detail_rows.append(row)

            if task in cat_scores:
                cat_scores[task].append(scores["final"])

        # ── Aggregate ─────────────────────────────────────────────────────────
        cat_avgs = {
            cat: round(sum(v) / len(v), 4) if v else 0.0
            for cat, v in cat_scores.items()
        }
        all_finals = [r["final_score"] for r in detail_rows]
        overall    = round(sum(all_finals) / len(all_finals), 4) if all_finals else 0.0

        results[model] = {
            "detail":   detail_rows,
            "category": cat_avgs,
            "overall":  overall,
        }

    # ── Build category matrix for chart data ──────────────────────────────────
    category_chart = {}
    for cat in categories:
        category_chart[cat] = {
            model: round(results[model]["category"].get(cat, 0) * 100, 2)
            for model in CUSTOM_MODELS
        }

    model_scores_summary = {
        model: {
            "overall":  results[model]["overall"],
            "category": results[model]["category"],
        }
        for model in CUSTOM_MODELS
    }

    # ── Recommendation ────────────────────────────────────────────────────────
    recommendation = generate_recommendation(
        model_scores_summary,
        {m: results[m]["category"] for m in CUSTOM_MODELS},
    )

    # ── Summary stats ─────────────────────────────────────────────────────────
    overall_bar_data = {
        model: round(results[model]["overall"] * 100, 2)
        for model in CUSTOM_MODELS
    }

    # Difficulty breakdown
    diff_breakdown = {}
    for model in CUSTOM_MODELS:
        diff_breakdown[model] = {}
        for diff in ["easy", "medium", "hard"]:
            rows = [r for r in results[model]["detail"] if r["difficulty"] == diff]
            if rows:
                diff_breakdown[model][diff] = round(
                    sum(r["final_score"] for r in rows) / len(rows) * 100, 2
                )
            else:
                diff_breakdown[model][diff] = None

    # Average response time per model
    avg_response_times = {
        model: round(
            sum(r["response_time"] for r in results[model]["detail"]) /
            max(len(results[model]["detail"]), 1),
            3,
        )
        for model in CUSTOM_MODELS
    }

    return jsonify({
        "mode":                mode,
        "difficulty_filter":   difficulty,
        "categories":          categories,
        "total_questions":     len(questions),
        "models":              CUSTOM_MODELS,
        "overall_scores":      overall_bar_data,
        "category_scores":     category_chart,
        "difficulty_scores":   diff_breakdown,
        "avg_response_times":  avg_response_times,
        "recommendation":      recommendation,
        "detail":              {m: results[m]["detail"] for m in CUSTOM_MODELS},
        "gemini_api_used":     gemini_api_used,
        "fallback_count":      fallback_count,
        "model_colors": {
            m: MODEL_INFO.get(m, {}).get("color", "#6c5ce7") for m in CUSTOM_MODELS
        },
    })


@app.route("/upload-custom-dataset", methods=["POST"])
def upload_custom_dataset():
    """
    Accept a user-uploaded custom dataset (JSON array).
    Validates structure, stores it temporarily, and returns a preview.
    """
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded."}), 400

    file = request.files["file"]
    if not file.filename.endswith(".json"):
        return jsonify({"error": "Only .json files are accepted."}), 400

    try:
        data = json.load(file)
    except json.JSONDecodeError as e:
        return jsonify({"error": f"Invalid JSON: {e}"}), 400

    if not isinstance(data, list) or len(data) == 0:
        return jsonify({"error": "Dataset must be a non-empty JSON array."}), 400

    # Validate required fields in each item
    required = {"task", "question", "expected_answer"}
    errors   = []
    valid    = []
    for i, item in enumerate(data):
        missing = required - set(item.keys())
        if missing:
            errors.append(f"Item {i+1} missing fields: {missing}")
        else:
            # Inject defaults for optional fields
            item.setdefault("id", i + 1)
            item.setdefault("difficulty", "medium")
            item.setdefault("keywords", [])
            valid.append(item)

    if not valid:
        return jsonify({"error": "No valid questions found.", "details": errors}), 400

    # Overwrite the active custom dataset in memory (not persisted to disk)
    global CUSTOM_DATASET
    CUSTOM_DATASET = valid

    categories = list({q["task"] for q in valid})
    difficulties = list({q.get("difficulty", "medium") for q in valid})

    return jsonify({
        "message":     f"Loaded {len(valid)} questions successfully.",
        "warnings":    errors,
        "categories":  categories,
        "difficulties": difficulties,
        "preview":     valid[:5],
    })


@app.route("/api-status")
def api_status():
    """Return whether the Gemini API is available and configured."""
    key_set = bool(os.environ.get("GEMINI_API_KEY", "").strip()) and \
              os.environ.get("GEMINI_API_KEY") != "your_gemini_api_key_here"
    return jsonify({
        "gemini_sdk_installed": GEMINI_AVAILABLE,
        "gemini_api_key_set":   key_set,
        "gemini_ready":         gemini_client is not None,
    })


# ═══════════════════════════════════════════════════════════════════════════════
# Entry Point
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    app.run(debug=True, port=5000)
