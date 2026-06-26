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
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
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

  async generateScenario(category) {
    return this.generateCommunicationScenario(category);
  }

  async evaluateResponse(question, answer) {
    return this.evaluateCommunicationResponse(question, answer);
  }

  async generateReport(exchanges) {
    return this.generateCommunicationReport(exchanges);
  }

  async generateCommunicationScenario(category) {
    const prompt = `You are an interview coach helping a student practice their communication skills for job interviews.

Question Category: ${category}

Create a realistic interview question for this category. The question should feel like something a real interviewer would ask.

Return ONLY valid JSON:
{
  "title": "A short label for this question type",
  "context": "A 1-2 sentence explanation of why interviewers ask this and what they look for",
  "opening": "The interview question itself, phrased naturally as an interviewer would say it"
}`;

    try {
      const text = await this.generateContent(prompt, "communication_scenario");
      const result = JSON.parse(cleanJsonResponse(text));
      return {
        title: result.title || `${category} Question`,
        context: result.context || 'Interviewers ask this to assess your communication skills.',
        opening: result.opening || 'Tell me about yourself.',
      };
    } catch (error) {
      throw new HttpError(500, `Question generation failed: ${error.message}`);
    }
  }

  async evaluateCommunicationResponse(question, answer) {
    const prompt = `You are a strict interview coach evaluating a candidate's response in a mock interview communication practice.

Interview Question:
${question}

Candidate's Answer:
${answer}

Evaluate the answer specifically on interview communication skills (0-10 each):
1. clarity — how clear, articulate, and easy to understand the answer is
2. structure — logical flow; for behavioral questions, look for STAR (Situation, Task, Action, Result)
3. conciseness — gets to the point without rambling or being too brief
4. relevance — directly answers the question asked, doesn't go off-topic
5. confidence_tone — sounds professional, confident, and appropriately assertive

Also provide:
- strengths: 1-2 specific things done well in the answer
- improvements: 1-2 specific, actionable things to improve
- feedback: One paragraph of coaching advice focusing on interview communication techniques
- next_prompt: The interviewer's natural follow-up question or the next logical interview question

Return ONLY valid JSON, no markdown:
{
  "clarity": 0,
  "structure": 0,
  "conciseness": 0,
  "relevance": 0,
  "confidence_tone": 0,
  "strengths": [],
  "improvements": [],
  "feedback": "",
  "next_prompt": ""
}`;

    try {
      const text = await this.generateContent(prompt, "communication_evaluation");
      const result = JSON.parse(cleanJsonResponse(text));

      for (const key of ["clarity", "structure", "conciseness", "relevance", "confidence_tone"]) {
        result[key] = clampScore(result[key]);
      }

      for (const key of ["strengths", "improvements"]) {
        if (!Array.isArray(result[key])) {
          result[key] = result[key] ? [String(result[key])] : [];
        }
      }

      if (typeof result.feedback !== "string" || !result.feedback.trim()) {
        result.feedback = "Keep practicing to improve your interview communication skills.";
      }

      if (typeof result.next_prompt !== "string" || !result.next_prompt.trim()) {
        result.next_prompt = "Can you tell me more about a specific example from your experience?";
      }

      return result;
    } catch (error) {
      throw new HttpError(500, `Communication evaluation failed: ${error.message}`);
    }
  }

  async generateCommunicationReport(exchanges) {
    const prompt = `Based on this interview communication practice session, create a comprehensive coaching report.

Exchange data:
${JSON.stringify(exchanges, null, 2)}

Return a JSON with:
- strengths: Array of 3-4 overall interview communication strengths demonstrated
- areas_to_improve: Array of 3-4 specific areas needing improvement in interview answers
- tips: Array of 4-5 actionable interview communication tips (e.g., use the STAR method, pause before answering, structure your response)

Return ONLY valid JSON:
{
  "strengths": [],
  "areas_to_improve": [],
  "tips": []
}`;

    try {
      const text = await this.generateContent(prompt, "communication_report");
      return JSON.parse(cleanJsonResponse(text));
    } catch (error) {
      throw new HttpError(500, `Report generation failed: ${error.message}`);
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
