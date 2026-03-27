import { generateText, type LanguageModel } from "ai";
import type { Candidate } from "../core/candidate.js";
import type { Stage, StageContext } from "../core/stage.js";

export interface LlmStageConfig {
  prompt: string;
  model: LanguageModel;
  confidenceThreshold?: number;
}

const SYSTEM_PROMPT = `You are a code review assistant. Analyze the code and determine if it violates the rule described in the prompt.

Respond ONLY with valid JSON in this exact format:
{"isViolation": true/false, "confidence": 0.0-1.0, "reasoning": "brief explanation"}

Do not include any other text before or after the JSON.`;

export function interpolatePrompt(
  template: string,
  candidate: Candidate,
): string {
  let result = template;

  // Replace $MATCHED_CODE with the matched source code
  result = result.replace(/\$MATCHED_CODE/g, candidate.matchedCode);

  // Replace $FILE_PATH with the file path
  result = result.replace(/\$FILE_PATH/g, candidate.fileContext.filePath);

  // Replace $VAR metavariables
  for (const [name, value] of Object.entries(candidate.metaVariables)) {
    result = result.replace(new RegExp(`\\$${name}\\b`, "g"), value);
  }

  return result;
}

interface LlmVerdict {
  isViolation: boolean;
  confidence: number;
  reasoning: string;
}

function parseVerdict(text: string): LlmVerdict {
  // Try to extract JSON from the response (handle markdown code blocks)
  let jsonStr = text.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);

  if (typeof parsed.isViolation !== "boolean") {
    throw new Error("Missing or invalid 'isViolation' field");
  }
  if (typeof parsed.confidence !== "number" || parsed.confidence < 0 || parsed.confidence > 1) {
    throw new Error("Missing or invalid 'confidence' field (must be 0-1)");
  }

  return {
    isViolation: parsed.isViolation,
    confidence: parsed.confidence,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
  };
}

export function createLlmStage(config: LlmStageConfig): Stage {
  const threshold = config.confidenceThreshold ?? 0.5;

  return {
    name: "llm",

    async process(candidates: Candidate[], context: StageContext): Promise<Candidate[]> {
      const results: Candidate[] = [];

      for (const candidate of candidates) {
        if (candidate.filtered) {
          results.push(candidate);
          continue;
        }

        const prompt = interpolatePrompt(config.prompt, candidate);

        try {
          const response = await generateText({
            model: config.model,
            system: SYSTEM_PROMPT,
            prompt,
            abortSignal: context.signal,
          });

          const verdict = parseVerdict(response.text);

          const annotated: Candidate = {
            ...candidate,
            annotations: {
              ...candidate.annotations,
              llmVerdict: verdict.isViolation,
              llmConfidence: verdict.confidence,
              llmReasoning: verdict.reasoning,
            },
          };

          if (!verdict.isViolation || verdict.confidence < threshold) {
            annotated.filtered = true;
          }

          results.push(annotated);
        } catch (error) {
          // On LLM failure, annotate with error but don't filter
          results.push({
            ...candidate,
            annotations: {
              ...candidate.annotations,
              llmError: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }

      return results;
    },
  };
}
