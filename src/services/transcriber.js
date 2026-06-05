import fs from "node:fs";
import Groq from "groq-sdk";
import { config } from "../config.js";
import { HttpError } from "../utils/httpError.js";
import { recordAiUsage } from "./aiUsageService.js";

class GroqWhisperTranscriber {
  constructor() {
    this.client = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;
  }

  setApiKey(apiKey) {
    config.groqApiKey = apiKey;
    this.client = new Groq({ apiKey });
  }

  getClient() {
    if (!this.client) {
      throw new HttpError(503, "Groq API key is not configured");
    }

    return this.client;
  }

  async transcribe(audioPath) {
    try {
      const response = await this.getClient().audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: "whisper-large-v3-turbo",
        language: "en",
        prompt: "Technical job interview. Candidate discussing software engineering, projects, and work experience.",
        response_format: "text",
        temperature: 0
      });

      await recordAiUsage({
        provider: "groq",
        model: "whisper-large-v3-turbo",
        feature: "speech_to_text"
      });
      return typeof response === "string" ? response.trim() : String(response.text || "").trim();
    } catch (error) {
      await recordAiUsage({
        provider: "groq",
        model: "whisper-large-v3-turbo",
        feature: "speech_to_text",
        status: "error",
        metadata: { message: error.message }
      });
      throw new Error(`Speech-to-text failed: ${error.message}`);
    }
  }
}

export const transcriber = new GroqWhisperTranscriber();
