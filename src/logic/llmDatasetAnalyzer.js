const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: ["coding", "math", "reasoning", "chat", "unclear"] },
    difficulty: { type: "string", enum: ["easy", "medium", "hard", "unknown"] },
    format: { type: "string", enum: ["MCQ", "open-ended", "code", "conversational", "mixed", "unknown"] },
    reasoning_required: { type: "boolean" },
    confidence: { type: "number" },
    rationale: { type: "string" }
  },
  required: ["type", "difficulty", "format", "reasoning_required", "confidence", "rationale"]
};

function getConfiguredGeminiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === "your_gemini_api_key_here") return null;
  return key;
}

function buildGeminiSampleSummary(samples) {
  return samples.map((sample, index) => {
    const text = typeof sample === "string" ? sample : JSON.stringify(sample);
    return `${index + 1}. ${text.slice(0, 300)}`;
  }).join("\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelayMs(errorText) {
  const match = errorText && errorText.match(/"retryDelay"\s*:\s*"([0-9.]+)s"/);
  if (!match) return 8000;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 8000;
}

function extractJsonString(text) {
  if (!text) return null;

  const trimmed = String(text).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function parseGeminiJson(text) {
  const jsonText = extractJsonString(text);
  if (!jsonText) return null;

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const compact = jsonText.replace(/\n/g, " ");
    const firstBrace = compact.indexOf("{");
    const lastBrace = compact.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(compact.slice(firstBrace, lastBrace + 1));
    }
    throw error;
  }
}

async function requestGeminiContentAnalysis(url, prompt) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 256,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    const error = new Error(`Gemini dataset analysis failed with ${response.status}${errorText ? `: ${errorText}` : ""}`);
    error.status = response.status;
    error.errorText = errorText;
    throw error;
  }

  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("")
    || payload.candidates?.[0]?.content?.parts?.[0]?.text
    || payload.output_text;

  return text ? parseGeminiJson(text) : null;
}

async function requestGeminiOpenAIAnalysis(url, prompt) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getConfiguredGeminiKey()}`
    },
    body: JSON.stringify({
      model: process.env.DATASET_ANALYZER_MODEL || "gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: "Return only valid JSON that matches the provided schema."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "dataset_analysis",
          strict: true,
          schema: ANALYSIS_SCHEMA
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    const error = new Error(`Gemini OpenAI-compatible analysis failed with ${response.status}${errorText ? `: ${errorText}` : ""}`);
    error.status = response.status;
    error.errorText = errorText;
    throw error;
  }

  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content;
  return text ? parseGeminiJson(text) : null;
}

async function analyzeDatasetWithLLM(samples) {
  const geminiKey = getConfiguredGeminiKey();

  if (!geminiKey) return null;

  try {
    const model = process.env.DATASET_ANALYZER_MODEL || "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`;
    const openAiUrl = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    const sampleSummary = buildGeminiSampleSummary(samples.slice(0, 4));
    const prompt = [
      "Classify benchmark dataset samples for model recommendation.",
      "Return only valid JSON that matches the schema.",
      "Use \"unclear\" if the task type is ambiguous.",
      "",
      "Samples:",
      sampleSummary
    ].join("\n");

    try {
      return await requestGeminiOpenAIAnalysis(openAiUrl, prompt);
    } catch (error) {
      if (error.status === 429) {
        const delayMs = parseRetryDelayMs(error.errorText || "");
        await sleep(delayMs);
      } else {
        console.warn("Gemini structured output path failed, falling back to direct REST:", error.message || error);
      }

      return await requestGeminiContentAnalysis(url, prompt);
    }
  } catch (error) {
    console.warn("Gemini analyzer error:", error.message || error);
    return null;
  }
}

module.exports = {
  analyzeDatasetWithLLM
};
