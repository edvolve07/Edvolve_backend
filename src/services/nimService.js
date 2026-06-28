import { config } from '../config.js';
import { HttpError } from '../utils/httpError.js';
import { recordAiUsage } from './aiUsageService.js';

function cleanJsonResponse(text) {
  if (!text) return '{}';
  const stripped = text.replace(/```(?:json)?/g, '').trim().replace(/`+$/g, '').trim();
  const match = stripped.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  return match ? match[0] : stripped;
}

function clampScore(value) {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num)) return 5;
  return Math.max(0, Math.min(10, num));
}

class NimService {
  constructor() {
    this.apiKey = config.nvidiaApiKey;
    this.baseUrl = config.nvidiaBaseUrl;
    this.model = config.nvidiaModel;
    this.fallbackModels = [
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'meta/llama3-70b-instruct',
    ];
  }

  async generate(prompt, feature = 'communication_chat') {
    if (!this.apiKey) {
      throw new HttpError(503, 'NVIDIA NIM API key is not configured. Set NVIDIA_NIM_API_KEY in .env');
    }

    let lastError;
    const models = [this.model, ...this.fallbackModels];
    const urls = [
      `${this.baseUrl}/chat/completions`,
      `https://integrate.api.nvidia.com/v1/chat/completions`,
    ];
    for (const model of models) {
      for (const url of urls) {
        try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 1024,
          }),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(`NIM API error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';

        await recordAiUsage({
          provider: 'nvidia_nim',
          model,
          feature,
          usage: data.usage || {},
        });

        return content;
      } catch (error) {
        lastError = error;
        await recordAiUsage({
          provider: 'nvidia_nim',
          model,
          feature,
          status: 'error',
          metadata: { message: error.message },
        });
      }
      }
    }

    throw new HttpError(500, `All NIM models failed: ${lastError?.message || lastError}`);
  }

  async generateScenario(category) {
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
      const text = await this.generate(prompt, 'comm_scenario');
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

  async evaluateResponse(question, answer, category = 'General') {
    const prompt = `You are a strict interview coach evaluating a candidate's response in a mock interview communication practice.

Question Category: ${category}

Interview Question:
${question}

Candidate's Answer:
${answer}

Evaluate the answer specifically on interview communication skills (0-10 each). Adjust emphasis based on category:
1. clarity — how clear, articulate, and easy to understand the answer is
2. structure — logical flow; for behavioral questions, look for STAR (Situation, Task, Action, Result); for technical categories, look for logical explanation flow
3. conciseness — gets to the point without rambling or being too brief
4. relevance — directly answers the question asked, doesn't go off-topic
5. confidence_tone — sounds professional, confident, and appropriately assertive

${category === 'Behavioral Questions (STAR)' ? 'For this category, weight "structure" higher — a strong STAR format is critical here.' : ''}
${category === 'Technical Explanations' ? 'For this category, weight "clarity" and "relevance" higher — the answer must demonstrate technical understanding clearly.' : ''}
${category === 'Salary & Negotiation Talk' ? 'For this category, weight "confidence_tone" higher — assertiveness and professionalism matter most here.' : ''}
${category === 'Tell Me About Yourself' ? 'For this category, weight "structure" and "relevance" higher — look for a coherent narrative that connects to the role.' : ''}

Also provide:
- strengths: 1-2 specific things done well in the answer
- improvements: 1-2 specific, actionable things to improve
- feedback: One paragraph of coaching advice focusing on interview communication techniques
- next_prompt: The interviewer's natural follow-up question or the next logical interview question
- real_world_tip: One specific, actionable tip for how this answer would land in a real interview and how to strengthen it further

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
  "next_prompt": "",
  "real_world_tip": ""
}`;

    try {
      const text = await this.generate(prompt, 'comm_evaluation');
      const result = JSON.parse(cleanJsonResponse(text));

      for (const key of ['clarity', 'structure', 'conciseness', 'relevance', 'confidence_tone']) {
        result[key] = clampScore(result[key]);
      }

      for (const key of ['strengths', 'improvements']) {
        if (!Array.isArray(result[key])) {
          result[key] = result[key] ? [String(result[key])] : [];
        }
      }

      if (typeof result.feedback !== 'string' || !result.feedback.trim()) {
        result.feedback = 'Keep practicing to improve your interview communication skills.';
      }

      if (typeof result.next_prompt !== 'string' || !result.next_prompt.trim()) {
        result.next_prompt = 'Can you tell me more about a specific example from your experience?';
      }

      if (typeof result.real_world_tip !== 'string' || !result.real_world_tip.trim()) {
        result.real_world_tip = 'In a real interview, aim to be specific and provide concrete examples from your experience.';
      }

      return result;
    } catch (error) {
      throw new HttpError(500, `Communication evaluation failed: ${error.message}`);
    }
  }

  async generateReport(exchanges, category = 'General') {
    const prompt = `Based on this interview communication practice session, create a comprehensive coaching report.

Question Category: ${category}

Exchange data:
${JSON.stringify(exchanges, null, 2)}

Return a JSON with the following structure:

1. strengths: Array of 3-4 overall interview communication strengths demonstrated
2. areas_to_improve: Array of 3-4 specific areas needing improvement in interview answers
3. tips: Array of 4-5 actionable interview communication tips (e.g., use the STAR method, pause before answering, structure your response)
4. category_insights: An object with:
   - category_mastery: One-sentence assessment of how well the student handled this question category
   - key_takeaway: The single most important thing to remember for this category in real interviews
   - recommended_focus: What to focus practice on for this category
5. real_world_preparation: Array of 4-5 specific, actionable tips for real-world interviews based on this student's performance (e.g., "In a real interview, follow up your technical answer with a concrete project example")
6. competency_analysis: An object with:
   - demonstrated_competencies: Array of competencies shown (e.g., ["Problem Solving", "Technical Knowledge", "Leadership"])
   - competencies_to_develop: Array of competencies that need development
   - communication_style: Assessment of their communication style (e.g., "Direct and concise but could benefit from more structured storytelling")

Return ONLY valid JSON:
{
  "strengths": [],
  "areas_to_improve": [],
  "tips": [],
  "category_insights": {
    "category_mastery": "",
    "key_takeaway": "",
    "recommended_focus": ""
  },
  "real_world_preparation": [],
  "competency_analysis": {
    "demonstrated_competencies": [],
    "competencies_to_develop": [],
    "communication_style": ""
  }
}`;

    try {
      const text = await this.generate(prompt, 'comm_report');
      const result = JSON.parse(cleanJsonResponse(text));

      result.strengths = Array.isArray(result.strengths) ? result.strengths : [];
      result.areas_to_improve = Array.isArray(result.areas_to_improve) ? result.areas_to_improve : [];
      result.tips = Array.isArray(result.tips) ? result.tips : [];
      result.real_world_preparation = Array.isArray(result.real_world_preparation) ? result.real_world_preparation : [];
      result.category_insights = (typeof result.category_insights === 'object' && result.category_insights !== null)
        ? result.category_insights
        : { category_mastery: '', key_takeaway: '', recommended_focus: '' };
      result.competency_analysis = (typeof result.competency_analysis === 'object' && result.competency_analysis !== null)
        ? result.competency_analysis
        : { demonstrated_competencies: [], competencies_to_develop: [], communication_style: '' };

      return result;
    } catch (error) {
      throw new HttpError(500, `Report generation failed: ${error.message}`);
    }
  }
}

export const nimService = new NimService();
