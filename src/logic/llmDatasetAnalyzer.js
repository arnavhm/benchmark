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

async function analyzeDatasetWithLLM(samples) {
  if (!process.env.OPENAI_API_KEY) return null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.DATASET_ANALYZER_MODEL || "gpt-5.4-mini",
      input: [
        {
          role: "developer",
          content: [
            {
              type: "input_text",
              text: "Classify benchmark dataset samples for model recommendation. Return only fields in the JSON schema. Use unclear if the task type is ambiguous."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(samples, null, 2)
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "dataset_analysis",
          strict: true,
          schema: ANALYSIS_SCHEMA
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`LLM dataset analysis failed with ${response.status}`);
  }

  const payload = await response.json();
  const text = payload.output_text
    || payload.output?.flatMap((item) => item.content || []).find((part) => part.type === "output_text")?.text;

  return text ? JSON.parse(text) : null;
}

module.exports = {
  analyzeDatasetWithLLM
};
