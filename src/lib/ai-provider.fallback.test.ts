import { describe, expect, it, vi } from "vitest";
vi.mock("./ai-key-vault.server", () => ({
  listVaultKeys: async () => [],
  usableKeys: () => [],
  groupByProvider: () => [],
  markVaultKey: async () => {},
}));
import {
  callOpenAICompatible,
  defaultVaultPriority,
  KEYLESS_KILO_MODELS_URL,
  OPENROUTER_FREE_MODEL,
  modelQueue,
  openAIToGemini,
  parseBulkVaultKeyImport,
  parseKiloFreeModels,
  shouldFallbackToKeyless,
  suggestedModels,
} from "./ai-provider.server";
for (const k of Object.keys(process.env)) if (/^GROQ_API_KEY/.test(k)) delete process.env[k]; // Dahl fallback tests must not hit the real Groq key

describe("provider fallback & thinking", () => {
  it("parses mixed .env entries into known providers without duplicates", () => {
    const parsed = parseBulkVaultKeyImport([
      'GEMINI_API_KEY="AIzaSyExampleKey123" # Google',
      "GROQ_API_KEY=gsk_exampleKey123",
      "CEREBRAS_API_KEY=csk-exampleKey123",
      "OPENROUTER_API_KEY=sk-or-v1-exampleKey123",
      "MISTRAL_API_KEY='mistral-example-key'",
      "AIzaSyExampleKey123",
      "UNKNOWN_SECRET=not-a-provider-key",
    ].join("\n"));
    expect(parsed.rows.map((row) => row.provider)).toEqual([
      "gemini",
      "groq",
      "cerebras",
      "openrouter",
      "mistral",
    ]);
    expect(parsed.ignored).toBe(1);
    expect(defaultVaultPriority("groq")).toBeLessThan(defaultVaultPriority("gemini"));
  });

  it("uses only live Kilo models marked :free", () => {
    expect(parseKiloFreeModels({ data: [
      { id: "paid/model" },
      { id: "mistralai/mistral-small:free" },
      { id: "meta-llama/llama-3.3:free" },
    ] })).toEqual(["meta-llama/llama-3.3:free", "mistralai/mistral-small:free"]);
    expect(shouldFallbackToKeyless(429, "rate limit")).toBe(true);
    expect(shouldFallbackToKeyless(401, "invalid API key")).toBe(false);
    expect(shouldFallbackToKeyless(null, "provider base URL is missing")).toBe(false);
    expect(shouldFallbackToKeyless(null, "network timeout")).toBe(true);
  });

  it("uses anonymous Kilo completions with no Authorization header", async () => {
    const calls: Array<{ url: string; auth: string | undefined; body: Record<string, unknown> }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      calls.push({ url, auth: headers?.Authorization, body });
      if (url === KEYLESS_KILO_MODELS_URL) {
        return new Response(JSON.stringify({ data: [
          { id: "meta-llama/llama-3.3-instruct:free" },
          { id: "provider/paid-model" },
        ] }), { status: 200 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "رد احتياطي" } }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const result = await callOpenAICompatible(
        { provider: "gemini", api_key: null, base_url: null, model: null },
        "أهلاً",
        {},
      );
      expect(result.text).toBe("رد احتياطي");
      const completion = calls.find((call) => call.url.endsWith("/chat/completions"));
      expect(completion?.auth).toBeUndefined();
      expect(completion?.body.model).toBe("meta-llama/llama-3.3-instruct:free");
      expect(calls.every((call) => call.auth === undefined)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses Kilo after a configured provider returns HTTP 429", async () => {
    const calls: Array<{ url: string; auth: string | undefined }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ url, auth: headers?.Authorization });
      if (url === "https://limited.example/v1/chat/completions")
        return new Response('{"error":{"message":"rate limit"}}', { status: 429 });
      if (url === KEYLESS_KILO_MODELS_URL)
        return new Response(JSON.stringify({ data: [{ id: "meta-llama/backup:free" }] }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "رد بعد نفاد الحصة" } }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const result = await callOpenAICompatible(
        { provider: "custom", api_key: "primary-key", base_url: "https://limited.example/v1", model: "primary-model" },
        "أهلاً",
        { deadlineMs: 5000, hedgeMs: 0 },
      );
      expect(result.text).toBe("رد بعد نفاد الحصة");
      expect(calls.some((call) => call.url.includes("api.kilo.ai") && call.url.endsWith("/chat/completions"))).toBe(true);
      expect(calls.filter((call) => call.url.includes("api.kilo.ai")).every((call) => call.auth === undefined)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not use the anonymous fallback for an invalid configured credential", async () => {
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response('{"error":{"message":"invalid API key"}}', { status: 401 });
    }) as typeof fetch;
    try {
      await expect(callOpenAICompatible(
        { provider: "dahl", api_key: "invalid-key", base_url: "https://inference.dahl.global/v1", model: "MiniMaxAI/MiniMax-M2.7" },
        "أهلاً",
        {},
      )).rejects.toThrow();
      expect(urls.every((url) => !url.includes("api.kilo.ai"))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("resolves the OpenRouter auto preset only to a zero-priced model", async () => {
    const calls: Array<{ url: string; auth: string | undefined; body: Record<string, unknown> }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      calls.push({ url, auth: headers?.Authorization, body });
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [
          { id: "openai/paid-model", pricing: { prompt: "1", completion: "2" } },
          { id: "meta-llama/free-model", pricing: { prompt: "0", completion: "0" } },
        ] }), { status: 200 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "من OpenRouter المجاني" } }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const result = await callOpenAICompatible(
        { provider: "openrouter", api_key: "router-test-key", base_url: "https://openrouter.ai/api/v1", model: OPENROUTER_FREE_MODEL },
        "أهلاً",
        {},
      );
      expect(result.text).toBe("من OpenRouter المجاني");
      const catalogCall = calls.find((call) => call.url.endsWith("/models"));
      expect(catalogCall?.auth).toBeUndefined();
      const completion = calls.find((call) => call.url.endsWith("/chat/completions"));
      expect(completion?.body.model).toBe("meta-llama/free-model");
      expect(completion?.auth).toBe("Bearer router-test-key");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reads the models the gateway says are available now", () => {
    const msg =
      '429 {"error":{"message":"busy. Other models available now: MiniMaxAI/MiniMax-M2.7, deepseek-ai/DeepSeek-V4-Flash-0731. You can switch to one of them."}}';
    expect(suggestedModels(msg)).toEqual([
      "MiniMaxAI/MiniMax-M2.7",
      "deepseek-ai/DeepSeek-V4-Flash-0731",
    ]);
  });
  it("moves <think> text into a thought part, keeping the reply clean", () => {
    const r = openAIToGemini({
      choices: [{ message: { content: "<think>العميل بيسلم</think>أهلاً!" } }],
    });
    expect(r.text).toBe("أهلاً!");
    expect(r.candidates[0].content.parts).toEqual([
      { text: "العميل بيسلم", thought: true },
      { text: "أهلاً!" },
    ]);
  });
  it("recovers a reply when the provider leaves <think> unclosed", () => {
    const r = openAIToGemini({
      choices: [{ message: { content: "<think>بفهم الطلب\n\nهتلاقي اللبن الطازج هنا." } }],
    });
    expect(r.text).toBe("هتلاقي اللبن الطازج هنا.");
    expect(r.candidates[0].content.parts).toEqual([
      { text: "بفهم الطلب", thought: true },
      { text: "هتلاقي اللبن الطازج هنا." },
    ]);
  });
  it("uses the backup key when the first key is busy (429)", async () => {
    const used: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const key = String((init.headers as Record<string, string>).Authorization).replace(
        "Bearer ",
        "",
      );
      used.push(key);
      if (key === "key-one")
        return new Response('{"error":{"message":"rate limit"}}', { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "تمام" } }] }), {
        status: 200,
      });
    }) as typeof fetch;
    try {
      const r = await callOpenAICompatible(
        {
          provider: "dahl",
          api_key: "key-one,key-two",
          base_url: "https://inference.dahl.global/v1",
          model: "zai-org/GLM-5.3-Flash",
        },
        [{ role: "user", parts: [{ text: "أهلاً" }] }],
        {},
      );
      expect(r.text).toBe("تمام");
      expect(used).toEqual(["key-one", "key-two"]);
    } finally {
      globalThis.fetch = orig;
    }
  });
  it("skips the backup key and switches model when the model itself is at concurrency capacity", async () => {
    const calls: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const key = String((init.headers as Record<string, string>).Authorization).replace(
        "Bearer ",
        "",
      );
      const model = JSON.parse(String(init.body)).model;
      calls.push(`${model}|${key}`);
      if (model === "zai-org/GLM-5.3-Flash") {
        return new Response(
          '{"error":{"code":"model_concurrency","message":"This model is at concurrency capacity."}}',
          { status: 429 },
        );
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "تمام" } }] }), {
        status: 200,
      });
    }) as typeof fetch;
    try {
      const r = await callOpenAICompatible(
        {
          provider: "dahl",
          api_key: "key-three,key-four",
          base_url: "https://other-dahl.dahl.global/v1",
          model: "zai-org/GLM-5.3-Flash",
        },
        "أهلاً",
        {},
      );
      expect(r.text).toBe("تمام");
      expect(calls).toEqual(["zai-org/GLM-5.3-Flash|key-three", "MiniMaxAI/MiniMax-M2.7|key-three"]);
    } finally {
      globalThis.fetch = orig;
    }
  });
  it("starts a second model in parallel when the first one is slow, and returns the faster reply", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model;
      if (model === "MiniMaxAI/MiniMax-M2.7") {
        // نموذج بطيء: لا يرد إلا عند الإلغاء.
        return new Promise<Response>((_res, rej) =>
          init.signal?.addEventListener("abort", () => rej(new Error("aborted"))),
        );
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: `من ${model}` } }] }), {
        status: 200,
      });
    }) as typeof fetch;
    try {
      const t = Date.now();
      const r = await callOpenAICompatible(
        {
          provider: "dahl",
          api_key: "k",
          base_url: "https://hedge.dahl.global/v1",
          model: "MiniMaxAI/MiniMax-M2.7",
        },
        "أهلاً",
        { hedgeMs: 50 },
      );
      expect(r.text).toBe("من zai-org/GLM-5.3-Flash");
      expect(Date.now() - t).toBeLessThan(2000);
    } finally {
      globalThis.fetch = orig;
    }
  });
  it("tries MiniMax before the other Dahl models, and the last working model first", () => {
    expect(modelQueue("zai-org/GLM-5.3-Flash", "https://x.dahl.global/v1", undefined)[1]).toBe(
      "MiniMaxAI/MiniMax-M2.7",
    );
    expect(
      modelQueue(
        "zai-org/GLM-5.3-Flash",
        "https://x.dahl.global/v1",
        "deepseek-ai/DeepSeek-V4-Flash-0731",
      )[0],
    ).toBe("deepseek-ai/DeepSeek-V4-Flash-0731");
  });
});
