interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export function logTokenUsage(
  command: string,
  usage?: TokenUsage,
  modelDetails?: { provider: string; model: string; tier: string },
) {
  console.log(`🧮 ${command} token usage:`, {
    ...modelDetails,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
  });
}
