import Groq from "groq-sdk";
import { config } from "../config.js";
import { HttpError } from "../utils/httpError.js";
import { recordAiUsage } from "./aiUsageService.js";

function cleanJsonResponse(text) {
  if (!text) {
    return "{}";
  }

  const stripped = text.replace(/```(?:json)?/g, "").trim().replace(/`+$/g, "").trim();
  const match = stripped.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  return match ? match[0] : stripped;
}

function clampScore(value) {
  const number = Number.parseInt(value, 10);
  if (Number.isNaN(number)) {
    return 5;
  }
  return Math.max(0, Math.min(10, number));
}

class AiService {
  constructor() {
    this.client = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;
    this.models = [
      "llama-3.1-8b-instant",
      "llama-3.3-70b-versatile",
      "mixtral-8x7b-32768"
    ];
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

  async generateContent(prompt, feature = "interview_chat") {
    let lastError;
    const client = this.getClient();

    for (const model of this.models) {
      try {
        const response = await client.chat.completions.create({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3
        });
        await recordAiUsage({
          provider: "groq",
          model,
          feature,
          usage: response.usage
        });
        return response.choices?.[0]?.message?.content || "";
      } catch (error) {
        lastError = error;
        await recordAiUsage({
          provider: "groq",
          model,
          feature,
          status: "error",
          metadata: { message: error.message }
        });
      }
    }

    throw new HttpError(500, `All Groq models failed: ${lastError?.message || lastError}`);
  }

  async analyzeResume(resumeText) {
    const prompt = `You are an ATS (Applicant Tracking System) expert.
Analyze this resume and return a JSON with:
1. ats_score (0-100)
2. skills_found (array of skills extracted)
3. improvements (array of 3-5 specific, actionable suggestions to improve the resume)

Resume:
${resumeText.slice(0, 2000)}

Return ONLY valid JSON:
{
  "ats_score": 0,
  "skills_found": [],
  "improvements": []
}`;

    try {
      const text = await this.generateContent(prompt, "resume_ats_analysis");
      const result = JSON.parse(cleanJsonResponse(text));
      return {
        ats_score: result.ats_score ?? 50,
        skills_found: Array.isArray(result.skills_found) ? result.skills_found : [],
        improvements: Array.isArray(result.improvements) ? result.improvements : []
      };
    } catch (error) {
      throw new HttpError(500, `ATS analysis failed: ${error.message}`);
    }
  }

  async generateFirstQuestion(resumeText, domain, role) {
    const prompt = `You are a technical interviewer for a ${role} position in the ${domain} domain.
Based on this resume, ask the FIRST interview question.

Resume:
${resumeText.slice(0, 1000)}

Guidelines:
- Start with something from their resume (project, skill, experience)
- Make it specific to the role and domain
- Be conversational
- Ask ONE question only, 1-2 sentences

Return ONLY the question text:`;

    try {
      const text = await this.generateContent(prompt, "interview_first_question");
      return text.trim().replace(/^["']|["']$/g, "");
    } catch (error) {
      throw new HttpError(500, `Question generation failed: ${error.message}`);
    }
  }

  async generateNextQuestion(resumeText, history, domain, role) {
    const conversation = history.slice(-5).map((turn) => {
      return `Q: ${turn.question}\nA: ${(turn.answer || "").slice(0, 300)}\n`;
    }).join("\n");

    const prompt = `You are a technical interviewer for a ${role} position in the ${domain} domain.
Continue this interview naturally. Base your next question on the candidate's background (from their resume) and the conversation so far.

Resume:
${resumeText.slice(0, 1000)}

Conversation history:
${conversation}

Your task:
- If the conversation suggests a natural follow-up, do that.
- If a topic from their resume hasn't been touched, ask a relevant question.
- Keep the interview flowing like a real conversation, not a script.
- Ask ONE question only, 1-2 sentences.

Return ONLY the question text:`;

    try {
      const text = await this.generateContent(prompt, "interview_next_question");
      return text.trim().replace(/^["']|["']$/g, "");
    } catch (error) {
      throw new HttpError(500, `Next question generation failed: ${error.message}`);
    }
  }

  async evaluateAnswer(question, answer, videoMetrics = null) {
    const videoSection = videoMetrics?.quality_flag === "good"
      ? `Video Analysis (already converted to 0-10 scale for you):
- Eye contact score : ${(Number(videoMetrics.eye_contact || 0) * 10).toFixed(1)}/10
- Attention score   : ${(Number(videoMetrics.attention || 0) * 10).toFixed(1)}/10
- Stability score   : ${(Number(videoMetrics.stability || 0) * 10).toFixed(1)}/10
- Face presence     : ${Math.round(Number(videoMetrics.face_presence || 0) * 100)}% of the interview was visible on camera
- Visibility level  : ${videoMetrics.visibility || "unknown"}`
      : `Video Analysis: Not available or low quality.
Score confidence and body_language based solely on the tone and phrasing of the answer text.`;

    const prompt = `You are a strict technical interviewer evaluating a candidate's response in an AI-powered interview.

QUESTION:
${question}

CANDIDATE'S ANSWER:
${answer}

${videoSection}

Scoring Rubric (apply consistently):
10 = Exceptional, would impress senior engineers
8 = Strong, clear competence with minor gaps
6 = Adequate, covers basics but lacks depth
4 = Weak, misses key points or has errors
2 = Poor, mostly incorrect or irrelevant
0 = No answer or completely off-topic

Evaluate on these dimensions (0-10 each):
1. confidence
2. body_language
3. knowledge
4. fluency
5. skill_relevance

Also provide:
- strengths: 1-2 specific things done well
- improvements: 1-2 specific, actionable things to improve
- feedback: One paragraph of coaching advice

Return ONLY valid JSON, no markdown:
{
  "confidence": 0,
  "body_language": 0,
  "knowledge": 0,
  "fluency": 0,
  "skill_relevance": 0,
  "strengths": [],
  "improvements": [],
  "feedback": ""
}`;

    try {
      const text = await this.generateContent(prompt, "interview_answer_evaluation");
      const result = JSON.parse(cleanJsonResponse(text));

      for (const key of ["confidence", "body_language", "knowledge", "fluency", "skill_relevance"]) {
        result[key] = clampScore(result[key]);
      }

      for (const key of ["strengths", "improvements"]) {
        if (!Array.isArray(result[key])) {
          result[key] = result[key] ? [String(result[key])] : [];
        }
      }

      if (typeof result.feedback !== "string" || !result.feedback.trim()) {
        result.feedback = "No feedback generated.";
      }

      return result;
    } catch (error) {
      throw new HttpError(500, `Evaluation failed: ${error.message}`);
    }
  }

  async generateOverallReport(atsData, evaluations) {
    const prompt = `Based on the complete interview data below, create a comprehensive report summary.

ATS Score: ${atsData.ats_score || 0}/100
Skills Found: ${(atsData.skills_found || []).join(", ")}

Per-question evaluations:
${JSON.stringify(evaluations, null, 2)}

Return a JSON with:
- strengths: Array of 3-4 overall strengths demonstrated in the interview
- areas_to_improve: Array of 3-4 specific areas needing improvement
- interview_tips: Array of 4-5 actionable tips for future interviews

Return ONLY valid JSON:
{
  "strengths": [],
  "areas_to_improve": [],
  "interview_tips": []
}`;

    try {
      const text = await this.generateContent(prompt, "interview_overall_report");
      return JSON.parse(cleanJsonResponse(text));
    } catch (error) {
      throw new HttpError(500, `Report generation failed: ${error.message}`);
    }
  }
}

export const aiService = new AiService();
