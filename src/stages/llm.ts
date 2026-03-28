import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { Candidate } from "../core/candidate.js";
import type { Stage, StageContext } from "../core/stage.js";

export interface LlmStageConfig {
  prompt: string;
  model: LanguageModel;
  confidenceThreshold?: number;
}

const verdictSchema = z.object({
  isViolation: z.boolean().describe("Whether the code violates the rule"),
  confidence: z.number().min(0).max(1).describe("Confidence in the verdict from 0 to 1"),
  reasoning: z.string().describe("Brief explanation of the verdict"),
});

type LlmVerdict = z.infer<typeof verdictSchema>;

const SYSTEM_PROMPT = `You are a code review assistant. Analyze the code and determine if it violates the rule described in the prompt.`;

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
          const response = await generateObject({
            model: config.model,
            system: SYSTEM_PROMPT,
            prompt,
            schema: verdictSchema,
            abortSignal: context.signal,
          });

          const verdict: LlmVerdict = response.object;

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
