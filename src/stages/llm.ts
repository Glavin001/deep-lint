import { createHash } from "node:crypto";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { Candidate } from "../core/candidate.js";
import type { Stage, StageContext, CacheableStage } from "../core/stage.js";

export interface LlmStageConfig {
  prompt: string;
  model: LanguageModel;
  confidenceThreshold?: number;
  seed?: number;
  modelId?: string;
}

const verdictSchema = z.object({
  isViolation: z.boolean().describe("Whether the code violates the rule"),
  confidence: z.number().min(0).max(1).describe("Confidence in the verdict from 0 to 1"),
  reasoning: z.string().describe("Brief explanation of the verdict"),
});

type LlmVerdict = z.infer<typeof verdictSchema>;

const SYSTEM_PROMPT = `You are a code review assistant. Analyze the code and determine if it violates the rule described in the prompt.`;

export function extractSurroundingLines(
  content: string,
  startLine: number,
  endLine: number,
  n: number,
): string {
  const lines = content.split("\n");
  // Lines are 1-indexed, array is 0-indexed
  const from = Math.max(0, startLine - 1 - n);
  const to = Math.min(lines.length, endLine + n);
  return lines.slice(from, to).join("\n");
}

export function interpolatePrompt(
  template: string,
  candidate: Candidate,
): string {
  let result = template;

  // Replace $MATCHED_CODE with the matched source code
  result = result.replace(/\$MATCHED_CODE/g, candidate.matchedCode);

  // Replace $FILE_PATH with the file path
  result = result.replace(/\$FILE_PATH/g, candidate.fileContext.filePath);

  // Replace $FILE_CONTENT with the full file content
  result = result.replace(/\$FILE_CONTENT/g, candidate.fileContext.content);

  // Replace $SURROUNDING(N) with N lines of context around the match
  result = result.replace(/\$SURROUNDING\((\d+)\)/g, (_match, nStr) => {
    const n = parseInt(nStr, 10);
    return extractSurroundingLines(
      candidate.fileContext.content,
      candidate.location.startLine,
      candidate.location.endLine,
      n,
    );
  });

  // Replace $START_LINE and $END_LINE
  result = result.replace(/\$START_LINE/g, String(candidate.location.startLine));
  result = result.replace(/\$END_LINE/g, String(candidate.location.endLine));

  // Replace $LANGUAGE
  result = result.replace(/\$LANGUAGE/g, candidate.fileContext.language);

  // Replace $VAR metavariables
  for (const [name, value] of Object.entries(candidate.metaVariables)) {
    result = result.replace(new RegExp(`\\$${name}\\b`, "g"), value);
  }

  return result;
}

const DEFAULT_SEED = 42;

export function computeLlmCacheKey(
  modelId: string,
  seed: number,
  threshold: number,
  interpolatedPrompt: string,
): string {
  return createHash("sha256")
    .update(`llm|${modelId}|${seed}|${threshold}|${interpolatedPrompt}`)
    .digest("hex");
}

export function createLlmStage(config: LlmStageConfig): Stage | CacheableStage {
  const threshold = config.confidenceThreshold ?? 0.5;
  const seed = config.seed ?? DEFAULT_SEED;
  const modelId = config.modelId;

  const stage: Stage = {
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
            seed,
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

  // Only implement CacheableStage when modelId is provided (opt-in)
  if (modelId) {
    return {
      ...stage,
      computeCacheKey(candidate: Candidate): string {
        const interpolated = interpolatePrompt(config.prompt, candidate);
        return computeLlmCacheKey(modelId, seed, threshold, interpolated);
      },
    } as CacheableStage;
  }

  return stage;
}
