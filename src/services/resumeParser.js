import pdfParse from "pdf-parse";
import { config } from "../config.js";
import { HttpError } from "../utils/httpError.js";

export async function extractTextFromPdf(buffer) {
  if (buffer.length > config.maxResumeSize) {
    throw new HttpError(400, "Resume too large (max 5MB)");
  }

  const parsed = await pdfParse(buffer);
  const text = parsed.text?.trim();
  return text || "No text extracted";
}
