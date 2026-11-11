import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  attachCodexRateLimitResetCreditDetails,
  codexDefaultBaseUrl,
  codexDefaultClientVersion,
  codexModelCatalogUrl,
  probeCodexProvider,
  codexModelCatalogFromPayloadForTest,
  codexProviderAccountConfig,
  codexRateLimitResetCreditDetails,
  normalizeCodexProviderAccountConfig
} from "@ccr/core/agents/local-providers/codex.ts";
import { localAgentProviderApiKey } from "@ccr/core/agents/local-providers/shared.ts";

test("Codex provider account config includes manual reset meter", () => {
  const config = codexProviderAccountConfig();
  const usageConnector = config.connectors.find((connector) => connector.type === "http-json" && connector.endpoint.endsWith("/wham/usage"));
  assert.ok(usageConnector);

  const meters = usageConnector.mapping.meters;
  const manualResetMeter = meters.find((meter) => meter.id === "codex_manual_resets");
  assert.ok(manualResetMeter);
  assert.equal(manualResetMeter.label, "Manual resets");
  assert.equal(manualResetMeter.unit, "resets");
  assert.equal(manualResetMeter.window, "manual-reset");
  assert.ok(Array.isArray(manualResetMeter.remaining));
  assert.ok(manualResetMeter.remaining.includes("$.resetsAvailable"));
  assert.ok(manualResetMeter.remaining.includes("$.availableRateLimitResetCount"));
  assert.ok(manualResetMeter.remaining.includes("$.rate_limit_reset_credits.available_count"));
  assert.ok(manualResetMeter.remaining.includes("$.rate_limit.manual_resets.remaining"));
  assert.equal(manualResetMeter.remaining.at(-1), 0);
  assert.ok(Array.isArray(manualResetMeter.resetAt));
  assert.ok(manualResetMeter.resetAt.includes("$.resetExpires"));
  assert.ok(manualResetMeter.resetAt.includes("$.expires_at"));
  assert.ok(manualResetMeter.resetAt.includes("$.rate_limit.manual_resets.expires_at"));
  assert.ok(manualResetMeter.resetAt.includes("$.manual_resets.reset_at"));

  const resetCreditsConnector = config.connectors.find((connector) => connector.type === "http-json" && connector.endpoint.endsWith("/wham/rate-limit-reset-credits"));
  assert.ok(resetCreditsConnector);
  const resetCreditsMeter = resetCreditsConnector.mapping.meters.find((meter) => meter.id === "codex_manual_resets");
  assert.ok(resetCreditsMeter);
  assert.deepEqual(resetCreditsMeter.remaining, ["$.available_count", "$.rate_limit_reset_credits.available_count", 0]);
});

test("Codex quota meters accept reset_at and resets_at usage shapes", () => {
  const config = codexProviderAccountConfig();
  const usageConnector = config.connectors.find((connector) => connector.type === "http-json" && connector.endpoint.endsWith("/wham/usage"));
  const primaryQuota = usageConnector.mapping.meters.find((meter) => meter.id === "codex_primary_quota");
  const secondaryQuota = usageConnector.mapping.meters.find((meter) => meter.id === "codex_secondary_quota");

  assert.ok(Array.isArray(primaryQuota.resetAt));
  assert.ok(primaryQuota.resetAt.includes("$.rate_limit.primary_window.reset_at"));
  assert.ok(primaryQuota.resetAt.includes("$.rate_limit.primary_window.resets_at"));
  assert.ok(primaryQuota.resetAt.includes("$.rate_limits.primary.resets_at"));
  assert.ok(Array.isArray(secondaryQuota.resetAt));
  assert.ok(secondaryQuota.resetAt.includes("$.rate_limit.secondary_window.reset_at"));
  assert.ok(secondaryQuota.resetAt.includes("$.rate_limit.secondary_window.resets_at"));
  assert.ok(secondaryQuota.resetAt.includes("$.rate_limits.secondary.resets_at"));
});

test("Codex local provider account config upgrades persisted usage mapping", () => {
  const oldAccount = JSON.parse(JSON.stringify(codexProviderAccountConfig()));
  oldAccount.refreshIntervalMs = 45000;
  const usageConnector = oldAccount.connectors.find((connector) => connector.type === "http-json" && connector.endpoint.endsWith("/wham/usage"));
  const manualResetMeter = usageConnector.mapping.meters.find((meter) => meter.id === "codex_manual_resets");
  manualResetMeter.remaining = manualResetMeter.remaining.filter((path) => path !== "$.rate_limit_reset_credits.available_count");

  const provider = normalizeCodexProviderAccountConfig({
    account: oldAccount,
    api_base_url: codexDefaultBaseUrl,
    api_key: localAgentProviderApiKey,
    models: ["gpt-5-codex"],
    name: "Codex API",
    protocol: "openai_responses"
  });

  const upgradedUsageConnector = provider.account.connectors.find((connector) => connector.type === "http-json" && connector.endpoint.endsWith("/wham/usage"));
  const upgradedResetCreditsConnector = provider.account.connectors.find((connector) => connector.type === "http-json" && connector.endpoint.endsWith("/wham/rate-limit-reset-credits"));
  const upgradedManualResetMeter = upgradedUsageConnector.mapping.meters.find((meter) => meter.id === "codex_manual_resets");
  assert.equal(provider.account.refreshIntervalMs, 45000);
  assert.ok(upgradedResetCreditsConnector);
  assert.ok(upgradedManualResetMeter.remaining.includes("$.rate_limit_reset_credits.available_count"));
});

test("Codex local provider config preserves imported GPT-5 context metadata", () => {
  const provider = normalizeCodexProviderAccountConfig({
    api_base_url: codexDefaultBaseUrl,
    api_key: localAgentProviderApiKey,
    modelMetadata: {
      "custom-model": {
        contextWindow: 64000,
        maxContextWindow: 64000
      },
      "gpt-5-codex": {
        contextWindow: 640000,
        maxContextWindow: 720000
      },
      "gpt-5.6-sol": {
        contextWindow: 1050000,
        maxContextWindow: 1050000
      }
    },
    models: ["gpt-5-codex", "gpt-5.5", "gpt-5.6-sol", "custom-model"],
    name: "Codex API",
    protocol: "openai_responses"
  });

  assert.deepEqual(provider.modelMetadata["gpt-5-codex"], {
    contextWindow: 640000,
    maxContextWindow: 720000
  });
  assert.equal(provider.modelMetadata["gpt-5.5"], undefined);
  assert.deepEqual(provider.modelMetadata["gpt-5.6-sol"], {
    contextWindow: 1050000,
    maxContextWindow: 1050000
  });
  assert.deepEqual(provider.modelMetadata["custom-model"], {
    contextWindow: 64000,
    maxContextWindow: 64000
  });

  const nonLocal = normalizeCodexProviderAccountConfig({
    api_base_url: codexDefaultBaseUrl,
    api_key: "real-api-key",
    modelMetadata: {
      "gpt-5.6-sol": {
        contextWindow: 1050000,
        maxContextWindow: 1050000
      }
    },
    models: ["gpt-5.6-sol"],
    name: "OpenAI",
    protocol: "openai_responses"
  });

  assert.deepEqual(nonLocal.modelMetadata["gpt-5.6-sol"], {
    contextWindow: 1050000,
    maxContextWindow: 1050000
  });
});

test("Codex local provider config preserves pinned context metadata", () => {
  const provider = normalizeCodexProviderAccountConfig({
    api_base_url: codexDefaultBaseUrl,
    api_key: localAgentProviderApiKey,
    modelMetadata: {
      "gpt-5-codex": {
        contextWindow: 1000000,
        contextWindowPinned: true,
        maxContextWindow: 1000000
      }
    },
    models: ["gpt-5-codex"],
    name: "Codex API",
    protocol: "openai_responses"
  });

  assert.deepEqual(provider.modelMetadata["gpt-5-codex"], {
    contextWindow: 1000000,
    contextWindowPinned: true,
    maxContextWindow: 1000000
  });
});

test("Codex reset credit details include available effective and expiry times", () => {
  const details = codexRateLimitResetCreditDetails({
    rate_limit_reset_credits: {
      credits: [
        {
          effective_at: "2026-07-03T00:00:00Z",
          expires_at: "2026-07-10T00:00:00Z",
          id: "reset-1",
          status: "available"
        },
        {
          effectiveAt: "2026-07-04T00:00:00Z",
          expiresAt: "2026-07-11T00:00:00Z",
          id: "reset-2",
          status: "available"
        },
        {
          effective_at: "2026-06-01T00:00:00Z",
          expires_at: "2026-06-08T00:00:00Z",
          id: "reset-expired",
          status: "expired"
        }
      ]
    }
  });

  assert.deepEqual(details.map((detail) => detail.id), ["reset-1", "reset-2"]);
  assert.equal(details[0].effectiveAt, "2026-07-03T00:00:00.000Z");
  assert.equal(details[0].expiresAt, "2026-07-10T00:00:00.000Z");
});

test("Codex reset credit details support reset credits endpoint shape", () => {
  const details = codexRateLimitResetCreditDetails({
    available_count: 2,
    credits: [
      {
        description: "Reset all Codex limits.",
        expires_at: "2026-08-02T00:00:00Z",
        id: "reset-root-1",
        start_date: "2026-07-03T00:00:00Z",
        status: "available",
        title: "Usage reset"
      },
      {
        expires_at: "2026-07-20T00:00:00Z",
        id: "reset-used",
        start_date: "2026-06-20T00:00:00Z",
        status: "used",
        title: "Used reset"
      }
    ]
  });

  assert.equal(details.length, 1);
  assert.equal(details[0].id, "reset-root-1");
  assert.equal(details[0].label, "Usage reset");
  assert.equal(details[0].description, "Reset all Codex limits.");
  assert.equal(details[0].redeemable, true);
  assert.equal(details[0].effectiveAt, "2026-07-03T00:00:00.000Z");
  assert.equal(details[0].expiresAt, "2026-08-02T00:00:00.000Z");
});

test("Codex reset credit details attach to manual reset meter", () => {
  const meters = attachCodexRateLimitResetCreditDetails([
    {
      id: "codex_manual_resets",
      kind: "requests",
      label: "Manual resets",
      remaining: 1,
      source: "http-json",
      unit: "resets",
      window: "manual-reset"
    }
  ], {
    rate_limit_reset_credits: {
      credits: [
        {
          effective_at: "2026-07-03T00:00:00Z",
          expires_at: "2026-07-10T00:00:00Z",
          id: "reset-1",
          status: "available"
        }
      ]
    }
  });

  assert.equal(meters[0].details.length, 1);
  assert.equal(meters[0].details[0].id, "reset-1");
  assert.equal(meters[0].resetAt, "2026-07-10T00:00:00.000Z");
});

test("Codex local provider account config keeps custom connectors", () => {
  const account = {
    connectors: [
      {
        auth: "none",
        endpoint: "https://example.com/account",
        mapping: {
          meters: [
            {
              id: "custom",
              kind: "balance",
              label: "Custom",
              remaining: "$.balance",
              unit: "credits"
            }
          ]
        },
        type: "http-json"
      }
    ],
    enabled: true
  };

  const provider = normalizeCodexProviderAccountConfig({
    account,
    api_base_url: codexDefaultBaseUrl,
    api_key: localAgentProviderApiKey,
    models: ["gpt-5-codex"],
    name: "Codex API",
    protocol: "openai_responses"
  });

  assert.equal(provider.account, account);
});

test("Codex model catalog parser accepts live model endpoint shapes", () => {
  const catalog = codexModelCatalogFromPayloadForTest({
    data: [
      {
        additional_speed_tiers: [{ id: "fast", label: "Fast" }],
        context_window: 272000,
        default_reasoning_level: "high",
        display_name: "GPT-5 Codex",
        effective_context_window_percent: 95,
        max_context_window: 300000,
        service_tiers: [{ id: "auto" }],
        slug: "gpt-5-codex",
        supports_fast_mode: true,
        supported_reasoning_levels: [
          { description: "Low", effort: "low" },
          { description: "High", effort: "high" }
        ],
        supports_reasoning_summaries: true
      },
      { displayName: "GPT-5.1 Codex", id: "gpt-5.1-codex" }
    ],
    models: [
      "gpt-5-codex",
      { label: "GPT-5.2 Codex", name: "gpt-5.2-codex" }
    ]
  });

  assert.deepEqual(catalog.models, ["gpt-5-codex", "gpt-5.1-codex", "gpt-5.2-codex"]);
  assert.deepEqual(catalog.modelDisplayNames, {
    "gpt-5-codex": "GPT-5 Codex",
    "gpt-5.1-codex": "GPT-5.1 Codex",
    "gpt-5.2-codex": "GPT-5.2 Codex"
  });
  assert.deepEqual(catalog.modelMetadata["gpt-5-codex"], {
    additionalSpeedTiers: [{ id: "fast", label: "Fast" }],
    contextWindow: 272000,
    defaultReasoningLevel: "high",
    effectiveContextWindowPercent: 95,
    maxContextWindow: 300000,
    serviceTiers: [{ id: "auto" }],
    supportsFastMode: true,
    supportedReasoningLevels: [
      { description: "Low", effort: "low" },
      { description: "High", effort: "high" }
    ],
    supportsReasoningSummaries: true
  });
  assert.equal(catalog.modelMetadata["gpt-5.1-codex"], undefined);
  assert.equal(catalog.modelMetadata["gpt-5.2-codex"], undefined);
});

test("Codex model catalog parser does not synthesize context metadata", () => {
  const catalog = codexModelCatalogFromPayloadForTest({
    models: [
      "gpt-5-codex",
      "gpt-5.5",
      "gpt-5.6",
      "gpt-5.6-sol",
      "gpt-5.6-terra-2026-07-28",
      "gpt-50"
    ]
  });

  assert.equal(catalog.modelMetadata, undefined);
});

test("Codex model catalog parser ignores invalid context metadata", () => {
  const catalog = codexModelCatalogFromPayloadForTest({
    models: [
      {
        context_window: -1,
        effective_context_window_percent: 101,
        max_context_window: 0,
        slug: "invalid-context-model"
      }
    ]
  });

  assert.equal(catalog.modelMetadata?.["invalid-context-model"], undefined);
});


test("Codex discovery sends the tested default client_version", () => {
  const url = new URL(codexModelCatalogUrl(""));
  assert.equal(url.origin + url.pathname, `${codexDefaultBaseUrl}/models`);
  assert.equal(url.searchParams.get("client_version"), codexDefaultClientVersion);
  assert.equal(codexDefaultClientVersion, "0.167.0");
});

test("Codex discovery permits an explicit client version without changing the endpoint", () => {
  assert.equal(new URL(codexModelCatalogUrl(" 0.168.1 ")).searchParams.get("client_version"), "0.168.1");
  assert.equal(new URL(codexModelCatalogUrl("0.168.1-beta.1")).searchParams.get("client_version"), "0.168.1-beta.1");
  for (const value of ["latest", "0.168", "0.168.1&redirect=evil", "https://example.com"]) {
    assert.throws(() => codexModelCatalogUrl(value), /semantic version/);
  }
});

test("Codex discovery reads CCR_CODEX_CLIENT_VERSION at request time", () => {
  const previous = process.env.CCR_CODEX_CLIENT_VERSION;
  try {
    process.env.CCR_CODEX_CLIENT_VERSION = "0.168.2";
    assert.equal(new URL(codexModelCatalogUrl()).searchParams.get("client_version"), "0.168.2");
    delete process.env.CCR_CODEX_CLIENT_VERSION;
    assert.equal(new URL(codexModelCatalogUrl()).searchParams.get("client_version"), codexDefaultClientVersion);
  } finally {
    if (previous === undefined) delete process.env.CCR_CODEX_CLIENT_VERSION;
    else process.env.CCR_CODEX_CLIENT_VERSION = previous;
  }
});


async function withMockedCodexCatalog(response, run) {
  const home = mkdtempSync(path.join(os.tmpdir(), "ccr-codex-discovery-"));
  const previousHome = process.env.CCR_INTERNAL_HOME_DIR;
  const previousVersion = process.env.CCR_CODEX_CLIENT_VERSION;
  const originalFetch = globalThis.fetch;
  try {
    mkdirSync(path.join(home, ".codex"));
    writeFileSync(path.join(home, ".codex", "auth.json"), JSON.stringify({
      tokens: { access_token: "synthetic-test-token", account_id: "test-account" }
    }), { mode: 0o600 });
    process.env.CCR_INTERNAL_HOME_DIR = home;
    process.env.CCR_CODEX_CLIENT_VERSION = "0.167.0";
    globalThis.fetch = async (input, init) => {
      assert.equal(new URL(String(input)).searchParams.get("client_version"), "0.167.0");
      assert.equal(init.headers.authorization, "Bearer synthetic-test-token");
      return response();
    };
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (previousHome === undefined) delete process.env.CCR_INTERNAL_HOME_DIR;
    else process.env.CCR_INTERNAL_HOME_DIR = previousHome;
    if (previousVersion === undefined) delete process.env.CCR_CODEX_CLIENT_VERSION;
    else process.env.CCR_CODEX_CLIENT_VERSION = previousVersion;
    rmSync(home, { recursive: true, force: true });
  }
}

const discoveryCandidate = {
  id: "codex-api", kind: "codex", name: "Codex API", status: "available", importable: true,
  protocol: "openai_responses", models: ["existing-model"]
};

test("Codex probe discovers the version-gated subscription catalog", async () => {
  await withMockedCodexCatalog(() => Response.json({ models: [
    { slug: "new-model-a", display_name: "New A" }, { slug: "new-model-b" }
  ] }), async () => {
    const result = await probeCodexProvider(discoveryCandidate);
    assert.deepEqual(result.candidate.models, ["new-model-a", "new-model-b"]);
    assert.deepEqual(discoveryCandidate.models, ["existing-model"]);
  });
});

for (const [label, response] of [
  ["HTTP error", () => Response.json({ error: { message: "unavailable" } }, { status: 429 })],
  ["empty catalog", () => Response.json({ models: [] })],
  ["transport failure", () => { throw new Error("synthetic network failure"); }]
]) {
  test(`Codex probe preserves existing models on ${label}`, async () => {
    await withMockedCodexCatalog(response, async () => {
      const result = await probeCodexProvider(discoveryCandidate);
      assert.deepEqual(result.candidate.models, ["existing-model"]);
    });
  });
}
