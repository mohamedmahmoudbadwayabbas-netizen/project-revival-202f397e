import { describe, expect, it } from "vitest";
import { withTrustedNawatPrompt, loadNawatSystemPrompt } from "./system-prompt";

describe("server-owned customer prompt", () => {
  it("replaces caller instructions and preserves the catalog tools", () => {
    const tools = [{ functionDeclarations: [{ name: "searchProducts" }] }];
    const caller = { systemInstruction: "caller-controlled", instructions: "alternate", tools };
    const safe = withTrustedNawatPrompt(caller, "trusted-server-value");
    expect(safe.systemInstruction).toBe("trusted-server-value");
    expect(safe).not.toHaveProperty("instructions");
    expect(safe.tools).toBe(tools);
    expect(caller.instructions).toBe("alternate");
  });
  it("scopes store configuration to Nawat and preferences to the authenticated customer", async () => {
    const reads: Array<{ table: string; column: string; value: string }> = [];
    const client = { from: (table: string) => ({
      select: () => ({ eq: (column: string, value: string) => {
        reads.push({ table, column, value });
        return { maybeSingle: async () => ({ data: null }) };
      } }),
    }) };
    await loadNawatSystemPrompt(client, "signed-in-customer");
    expect(reads).toEqual([
      { table: "ai_agent_configs", column: "agent_name", value: "nawat" },
      { table: "profiles", column: "id", value: "signed-in-customer" },
    ]);
  });
});