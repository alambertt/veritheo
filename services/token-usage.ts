interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export function logTokenUsage(command: string, usage?: TokenUsage) {
  console.log(`🧮 ${command} token usage:`, {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
  });
}
