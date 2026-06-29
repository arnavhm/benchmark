const TYPE_TO_BENCHMARKS = {
  coding: ["HumanEval", "Code generation benchmarks"],
  math: ["GSM8K", "Mathematical reasoning benchmarks"],
  reasoning: ["MMLU", "Reasoning and knowledge benchmarks"],
  chat: ["Chat benchmarks", "Instruction following benchmarks"],
  unclear: ["Balanced benchmark mix"]
};

function mapToBenchmarks(datasetAnalysis) {
  const type = datasetAnalysis?.type || "unclear";
  return TYPE_TO_BENCHMARKS[type] || TYPE_TO_BENCHMARKS.unclear;
}

module.exports = {
  mapToBenchmarks,
  TYPE_TO_BENCHMARKS
};
