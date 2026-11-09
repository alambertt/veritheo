import { expect, it } from "bun:test";

it("sends oversized answers when the real summarizer SDK is saturated", () => {
  // Subprocess: ai-services.test.ts mocks "ai" suite-wide.
  const result = Bun.spawnSync([process.execPath, "test", "./tests/fixtures/summarize-saturation.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "pipe", stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  expect(result.exitCode).toBe(0);
});
