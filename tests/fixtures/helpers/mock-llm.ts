import { MockLanguageModelV3 } from "ai/test";

interface LlmVerdict {
  isViolation: boolean;
  confidence: number;
  reasoning: string;
}

function makeResponse(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    rawCall: { rawPrompt: null, rawSettings: {} },
    usage: { inputTokens: 10, outputTokens: 20 },
    finishReason: "stop" as const,
    response: { id: "mock", modelId: "mock", timestamp: new Date() },
  };
}

export function createMockModel(verdict: LlmVerdict) {
  return new MockLanguageModelV3({
    doGenerate: async () => makeResponse(JSON.stringify(verdict)),
  });
}

export function createMockModelFromFn(
  fn: (prompt: string) => LlmVerdict,
) {
  return new MockLanguageModelV3({
    doGenerate: async ({ prompt }) => {
      // Extract the user prompt text from the prompt structure
      let promptText = "";
      if (typeof prompt === "string") {
        promptText = prompt;
      } else if (Array.isArray(prompt)) {
        for (const msg of prompt) {
          if (msg.role === "user" && Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === "text") {
                promptText += part.text;
              }
            }
          }
        }
      }
      const verdict = fn(promptText);
      return makeResponse(JSON.stringify(verdict));
    },
  });
}

export function createMockModelWithError(errorMessage: string) {
  return new MockLanguageModelV3({
    doGenerate: async () => makeResponse("this is not valid json"),
  });
}
