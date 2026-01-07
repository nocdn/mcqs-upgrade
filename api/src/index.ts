import { Hono } from "hono";
import { cors } from "hono/cors";
import { sql } from "./db";
import { getCached, invalidateCache, checkRateLimit } from "./redis";
import { z } from "zod";
import { validator } from "hono/validator";
import {
  generateText,
  streamText,
  convertToModelMessages,
  UIMessage,
} from "ai";
import { perplexity } from "@ai-sdk/perplexity";
import type { Context, Next } from "hono";

const app = new Hono();

// Enable CORS for all origins (dev mode)
app.use("*", cors());

// Rate limiting middleware factory
function rateLimit(limit: number, windowSeconds: number) {
  return async (c: Context, next: Next) => {
    // Get client IP from various headers (cloudflare, proxy, or direct)
    const ip =
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
      c.req.header("x-real-ip") ||
      "unknown";

    const endpoint = c.req.path.replace(/^\/api\//, "");
    const key = `ratelimit:${endpoint}:${ip}`;

    const { allowed, remaining, resetAt } = await checkRateLimit(
      key,
      limit,
      windowSeconds
    );

    // Set rate limit headers
    c.header("X-RateLimit-Limit", limit.toString());
    c.header("X-RateLimit-Remaining", remaining.toString());
    c.header("X-RateLimit-Reset", Math.floor(resetAt / 1000).toString());

    if (!allowed) {
      return c.json(
        {
          error: "Rate limit exceeded",
          message: `Too many requests. Limit: ${limit} requests per ${
            windowSeconds >= 86400
              ? Math.floor(windowSeconds / 86400) + " day(s)"
              : Math.floor(windowSeconds / 60) + " minute(s)"
          }`,
          retryAfter: Math.floor(resetAt / 1000),
        },
        429
      );
    }

    await next();
  };
}

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

async function createQuestion(
  questionText: string,
  options: string[],
  answer: string,
  topic: string
) {
  try {
    const [newQuestion] = await sql`
      INSERT INTO questions (question, options, answer, topic)
      VALUES (${questionText}, ${JSON.stringify(options)}, ${answer}, ${topic})
      RETURNING *;
    `;

    console.log("Question Created:", newQuestion.id);
    return newQuestion;
  } catch (error) {
    console.error("Error creating question:", error);
    return null;
  }
}

async function createExplanation(questionId: number, explanationText: string) {
  try {
    const [updatedRow] = await sql`
      UPDATE questions
      SET explanation = ${explanationText}
      WHERE id = ${questionId}
      RETURNING *;
    `;

    console.log("Explanation Updated for ID:", updatedRow.id);
    return updatedRow;
  } catch (error) {
    console.error("Error updating explanation:", error);
    return null;
  }
}

async function pullExplanation(questionId: number) {
  try {
    const [row] = await sql`
      SELECT explanation FROM questions WHERE id = ${questionId}
    `;

    if (!row) {
      console.log("No question found with ID:", questionId);
      return null;
    }

    console.log("Pulled Explanation:", row.explanation);
    return row.explanation;
  } catch (error) {
    console.error("Error pulling explanation:", error);
    return null;
  }
}

const explainSchema = z.object({
  questionId: z.number(),
  question: z.string(),
  answer: z.string(),
});

app.post(
  "/api/explain",
  rateLimit(15, 86400), // 15 requests per day
  validator("json", (value, c) => {
    const parsed = explainSchema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: parsed.error }, 400);
    }
    return parsed.data;
  }),
  async (c) => {
    const { questionId, question, answer } = c.req.valid("json");

    // Check if explanation already exists in DB
    const [existing] = await sql`
      SELECT explanation, explanation_sources
      FROM questions
      WHERE id = ${questionId}
    `;

    if (existing?.explanation) {
      console.log(`Explanation already exists for question ${questionId}`);
      return c.json({
        explanation: existing.explanation,
        sources: existing.explanation_sources || [],
      });
    }

    // Generate new explanation with Perplexity (using reasoning model for better quality)
    const prompt = `In simple terms, please explain why "${answer}" is the correct answer to this question: "${question}". Do NOT use any sort of markdown formatting. Cite multiple sources. Do not start the explanation with anything like "Explanation: ", just start the explanation.`;

    const { text, sources } = await generateText({
      model: perplexity("sonar-reasoning-pro"),
      prompt,
      providerOptions: {
        perplexity: {
          web_search_options: {
            search_context_size: "high",
          },
        },
      },
    });

    // Strip thinking tokens from reasoning model response
    const cleanedText = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();

    // Extract URLs from sources (filter for url sourceType only)
    const sourceUrls =
      sources
        ?.filter((s) => s.sourceType === "url" && "url" in s)
        .map((s) => (s as { url: string }).url)
        .filter(Boolean) || [];

    // Save explanation and sources to DB
    await sql`
      UPDATE questions
      SET explanation = ${cleanedText},
          explanation_sources = ${JSON.stringify(sourceUrls)}
      WHERE id = ${questionId}
    `;

    // Invalidate cache so next fetch gets the explanation
    await invalidateCache("questions:*");

    console.log(`Saved explanation for question ${questionId}`);
    return c.json({ explanation: cleanedText, sources: sourceUrls });
  }
);

// Chat endpoint for follow-up questions
app.post("/api/chat", rateLimit(35, 86400), async (c) => {
  // 35 requests per day
  const {
    messages,
    reasoning,
    explanationContext,
  }: {
    messages: UIMessage[];
    reasoning?: boolean;
    explanationContext?: string;
  } = await c.req.json();

  const model = reasoning ? "sonar-reasoning-pro" : "sonar";
  console.log(
    `Chat request with reasoning=${reasoning}, using model: ${model}`
  );

  // Build system prompt with explanation context if provided
  const systemPrompt = explanationContext
    ? `You are a helpful assistant helping the user understand an explanation to a quiz question. Here is the explanation they are asking about:\n\n${explanationContext}\n\nAnswer their follow-up questions about this explanation. Be concise and helpful.`
    : undefined;

  const result = streamText({
    model: perplexity(model),
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse({
    sendSources: true,
  });
});

app.get("/api/questions", rateLimit(2, 60), async (c) => {
  // 2 requests per minute
  const topic = c.req.query("topic");

  // Cache key: specific topic or "all"
  const cacheKey = topic ? `questions:${topic}` : "questions:all";

  const data = await getCached(
    cacheKey,
    async () => {
      const rows = await sql<
        {
          id: number;
          question: string;
          options: unknown;
          answer: string;
          topic: string;
          explanation: string | null;
          explanation_sources: unknown;
        }[]
      >`
        SELECT id, question, options, answer, topic, explanation, explanation_sources
        FROM questions
        ${topic ? sql`WHERE topic = ${topic}` : sql``}
        ORDER BY id ASC
      `;

      const questions = rows.map((r) => ({
        id: r.id,
        question: r.question,
        options:
          typeof r.options === "string"
            ? JSON.parse(r.options)
            : (r.options as string[]),
        answer: r.answer,
        ...(topic ? {} : { topic: r.topic }),
        explanation: r.explanation || null,
        explanationSources:
          typeof r.explanation_sources === "string"
            ? JSON.parse(r.explanation_sources)
            : (r.explanation_sources as string[]) || [],
      }));

      return {
        set: topic || "all",
        questions,
      };
    },
    86400 // 1 day TTL
  );

  return c.json(data);
});

const bulkCreateSchema = z.object({
  name: z.string(), // The topic name (e.g., "SPID")
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
      answer: z.string(),
    })
  ),
});

app.post(
  "/api/questions/bulk",
  validator("json", (value, c) => {
    const parsed = bulkCreateSchema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: parsed.error }, 400);
    }
    return parsed.data;
  }),
  async (c) => {
    const { name: topic, questions } = c.req.valid("json");

    if (questions.length === 0) {
      return c.json({ message: "No questions provided" }, 400);
    }

    try {
      // Bun SQL bulk insert expects an ARRAY OF OBJECTS, not arrays
      const rowsToInsert = questions.map((q) => ({
        question: q.question,
        options: JSON.stringify(q.options),
        answer: q.answer,
        topic: topic,
      }));

      // Use sql() helper for bulk insert (from Bun docs)
      const result = await sql`
        INSERT INTO questions ${sql(rowsToInsert)}
        RETURNING id
      `;

      // Invalidate cache for this topic so new questions are served
      await invalidateCache(`questions:${topic}`);

      return c.json(
        {
          message: "Successfully created questions",
          count: result.length,
          topic: topic,
        },
        201
      );
    } catch (error) {
      console.error("Bulk insert error:", error);
      return c.json({ error: "Failed to insert questions" }, 500);
    }
  }
);

export default { port: 8787, fetch: app.fetch };
