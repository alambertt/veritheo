import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

let requests: RequestInit[] = [];
let statuses: number[] = [];
let retryAfter = "1";
let hang = false;
const provider = createGoogleGenerativeAI({
  apiKey: "fixture-only-not-a-real-key",
  fetch: (async (_input: unknown, init?: RequestInit) => {
    requests.push(init!);
    if (hang) {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!;
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    const status = statuses.shift() ?? 200;
    return new Response(JSON.stringify(status === 200 ? {
      candidates: [{ content: { role: "model", parts: [{ text: "Complete analysis" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    } : { error: { code: status, message: "This model is currently experiencing high demand. Please try again later.", status: "UNAVAILABLE" } }), {
      status, headers: { "content-type": "application/json", "retry-after-ms": retryAfter },
    });
  }) as typeof fetch,
});
// Use the real AI SDK and Google adapter, but intercept every provider HTTP call.
mock.module("@ai-sdk/google", () => ({ google: provider }));
const { detectUserHeresy } = await import("../../services/heresy");
const input = { messages: ["Synthetic theological opinion"] };

beforeEach(() => { requests = []; statuses = []; retryAfter = "1"; hang = false; });
afterEach(() => mock.restore());

describe("real SDK /my_heresy retry policy with mocked HTTP", () => {
  it("recovers from one saturation failure on the same model and Flex tier", async () => {
    statuses = [503, 200];
    expect((await detectUserHeresy(input)).text).toBe("Complete analysis");
    expect(requests).toHaveLength(2);
    expect(requests.map((r) => JSON.parse(r.body as string).serviceTier)).toEqual(["flex", "flex"]);
  });

  it("stops after two calls when saturation persists", async () => {
    statuses = [503, 503, 200];
    await expect(detectUserHeresy(input)).rejects.toMatchObject({
      name: "AI_RetryError", lastError: { statusCode: 503 },
    });
    expect(requests).toHaveLength(2);
  });

  it("recovers from a transient rate limit", async () => {
    statuses = [429, 200];
    expect((await detectUserHeresy(input)).text).toBe("Complete analysis");
    expect(requests).toHaveLength(2);
  });

  it.each([400, 401, 403, 404])("does not retry terminal HTTP %i", async (status) => {
    statuses = [status, 200];
    await expect(detectUserHeresy(input)).rejects.toMatchObject({ statusCode: status });
    expect(requests).toHaveLength(1);
  });

  function accelerateDeadlineTimers() {
    const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
    const delays: number[] = [];
    spyOn(AbortSignal, "timeout").mockImplementation((delay) => {
      delays.push(delay);
      return originalTimeout(delay === 60_000 ? 30 : delay);
    });
    return delays;
  }

  it("aborts a stalled provider request at the total deadline without retrying", async () => {
    hang = true;
    const delays = accelerateDeadlineTimers();
    expect((await detectUserHeresy(input).catch((error) => error)).name).toBe("TimeoutError");
    expect(delays).toEqual([60_000]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.signal?.aborted).toBe(true);
  });

  it("includes Retry-After backoff in the overall deadline", async () => {
    statuses = [503, 200];
    retryAfter = "59000";
    const delays = accelerateDeadlineTimers();
    expect((await detectUserHeresy(input).catch((error) => error)).name).toBe("AbortError");
    expect(delays).toContain(60_000);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.signal?.reason.name).toBe("TimeoutError");
  });
});

// Exercise the installed provider without the service tests' module mocks.
it("sends Google Search for Argon without unsupported-tool warnings", async () => {
  const result = await provider("gemini-4-argon").doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "Find a source." }] }],
    tools: [{ type: "provider", id: "google.google_search", name: "google_search", args: {} }],
  });
  expect(JSON.parse(requests[0]!.body as string).tools).toEqual([{ googleSearch: {} }]);
  expect(result.warnings).toEqual([]);
});
