import { config } from "../config.js";
import { ApiKey } from "../database/models/ApiKey.js";
import { aiService } from "./aiService.js";
import { getSequelize } from "../database/connection.js";

const PROVIDERS = {
  groq: {
    id: "groq",
    name: "Groq",
    envKey: "GROQ_API_KEY",
    description: "Primary LLM provider for interviews, transcription, and question generation.",
  },
  nvidia: {
    id: "nvidia",
    name: "NVIDIA NIM",
    envKey: "NVIDIA_NIM_API_KEY",
    description: "Fallback LLM provider for question generation.",
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    envKey: "OPENAI_API_KEY",
    description: "Alternative LLM provider for evaluations and report generation.",
  },
  generic: {
    id: "generic",
    name: "Generic OpenAI-compatible",
    envKey: "GENERIC_OPENAI_API_KEY",
    description: "Self-hosted or alternative OpenAI-compatible provider for LLM calls.",
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    envKey: "GEMINI_API_KEY",
    description: "Google Gemini API for supplementary evaluation and analysis tasks.",
  },
};

let providerById = new Map(PROVIDERS.entries());

function maskSecret(value) {
  if (!value) return null;
  return value.slice(0, 6) + "…" + value.slice(-4);
}

function serializeProvider(provider, apiKey) {
  return {
    id: provider.id,
    name: provider.name,
    env_key: provider.envKey,
    description: provider.description,
    configured: Boolean(apiKey),
    masked_value: maskSecret(apiKey),
    updated_runtime: provider.id === "groq",
  };
}

export function getProviders() {
  return PROVIDERS;
}

export function getProviderById(id) {
  return PROVIDERS[id] || null;
}

export function serializeProviders(keys) {
  return Object.values(PROVIDERS).map((p) =>
    serializeProvider(p, keys[p.id] || process.env[p.envKey] || "")
  );
}

export async function loadApiKeysFromDb() {
  const keys = {};
  try {
    const rows = await ApiKey.findAll({ raw: true });
    for (const row of rows) {
      keys[row.provider] = row.api_key;
    }
  } catch (error) {
    console.warn("Could not load API keys from DB, falling back to env vars:", error.message);
  }

  for (const provider of Object.values(PROVIDERS)) {
    const dbValue = keys[provider.id];
    const envValue = process.env[provider.envKey];
    if (dbValue) {
      process.env[provider.envKey] = dbValue;
      if (provider.id === "groq") {
        config.groqApiKeys = dbValue.split(",").map((s) => s.trim()).filter(Boolean);
      }
    } else if (!envValue) {
      continue;
    }
  }

  aiService.rebuildClients();
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    const { transcriber } = await import("./transcriber.js");
    transcriber.setApiKey(groqKey);
  }
}

export async function updateApiKeyInDb(providerId, apiKey, updatedBy = "") {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  const value = String(apiKey || "").trim();
  if (value.length < 8) throw new Error("API key is too short (min 8 characters)");

  await ApiKey.upsert({
    provider: providerId,
    api_key: value,
    updated_by: updatedBy,
  });

  process.env[provider.envKey] = value;

  if (provider.id === "groq") {
    config.groqApiKeys = value.split(",").map((s) => s.trim()).filter(Boolean);
    aiService.rebuildClients();
    const { transcriber } = await import("./transcriber.js");
    transcriber.setApiKey(value);
  }

  return serializeProvider(provider, value);
}
