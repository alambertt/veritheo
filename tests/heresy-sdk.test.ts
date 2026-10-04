import { expect, it } from "bun:test";

it("verifies the real SDK in isolation from suite-wide AI mocks", async () => {
  const result = Bun.spawnSync([process.execPath, "test", "./tests/fixtures/heresy-sdk.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, TYPESAFE_HERESY_SELECTION: "off" },
    stdout: "pipe", stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  expect(result.exitCode).toBe(0);
});
