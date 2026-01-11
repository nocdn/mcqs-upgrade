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

app.use("*", cors());

function rateLimit(limit: number, windowSeconds: number) {
  return async (c: Context, next: Next) => {
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
  return c.text("Hello Hono");
});

function parseUserAgent(ua: string) {
  let deviceType = "desktop";
  if (/mobile/i.test(ua)) deviceType = "mobile";
  else if (/tablet|ipad/i.test(ua)) deviceType = "tablet";

  let browser = "unknown";
  if (/firefox/i.test(ua)) browser = "Firefox";
  else if (/edg/i.test(ua)) browser = "Edge";
  else if (/chrome/i.test(ua)) browser = "Chrome";
  else if (/safari/i.test(ua)) browser = "Safari";

  let os = "unknown";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/mac os/i.test(ua)) os = "macOS";
  else if (/linux/i.test(ua)) os = "Linux";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad/i.test(ua)) os = "iOS";

  return { deviceType, browser, os };
}

const logSchema = z.object({
  fingerprint: z.string(),
});

app.post(
  "/api/log",
  validator("json", (value, c) => {
    const parsed = logSchema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: parsed.error }, 400);
    }
    return parsed.data;
  }),
  async (c) => {
    const { fingerprint } = c.req.valid("json");
    const ip =
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
      c.req.header("x-real-ip") ||
      "unknown";
    const userAgent = c.req.header("user-agent") || "unknown";
    const { deviceType, browser, os } = parseUserAgent(userAgent);

    const country = c.req.header("cf-ipcountry") || null;
    const city = c.req.header("cf-ipcity") || null;

    try {
      await sql`
        INSERT INTO visitors (fingerprint, ip_address, user_agent, device_type, browser, os, country, city)
        VALUES (${fingerprint}, ${ip}, ${userAgent}, ${deviceType}, ${browser}, ${os}, ${country}, ${city})
        ON CONFLICT (fingerprint)
        DO UPDATE SET
          ip_address = EXCLUDED.ip_address,
          user_agent = EXCLUDED.user_agent,
          device_type = EXCLUDED.device_type,
          browser = EXCLUDED.browser,
          os = EXCLUDED.os,
          country = EXCLUDED.country,
          city = EXCLUDED.city,
          visit_count = visitors.visit_count + 1,
          last_seen = NOW()
      `;
      return c.json({ ok: true });
    } catch (error) {
      console.error("[api] Error logging visitor:", error);
      return c.json({ error: "Failed to log visitor" }, 500);
    }
  }
);

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

    console.log("[api] Question created:", newQuestion.id);
    return newQuestion;
  } catch (error) {
    console.error("[api] Error creating question:", error);
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

    console.log("[api] Explanation updated for ID:", updatedRow.id);
    return updatedRow;
  } catch (error) {
    console.error("[api] Error updating explanation:", error);
    return null;
  }
}

async function pullExplanation(questionId: number) {
  try {
    const [row] = await sql`
      SELECT explanation FROM questions WHERE id = ${questionId}
    `;

    if (!row) {
      console.log("[api] No question found with ID:", questionId);
      return null;
    }

    console.log("[api] Pulled explanation:", row.explanation);
    return row.explanation;
  } catch (error) {
    console.error("[api] Error pulling explanation:", error);
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
  rateLimit(30, 86400),
  validator("json", (value, c) => {
    const parsed = explainSchema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: parsed.error }, 400);
    }
    return parsed.data;
  }),
  async (c) => {
    const { questionId, question, answer } = c.req.valid("json");

    const [existing] = await sql`
      SELECT explanation, explanation_sources
      FROM questions
      WHERE id = ${questionId}
    `;

    if (existing?.explanation) {
      console.log(`[api] Explanation already exists for question ${questionId}`);
      return c.json({
        explanation: existing.explanation,
        sources: existing.explanation_sources || [],
      });
    }

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

    const cleanedText = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();

    const sourceUrls =
      sources
        ?.filter((s) => s.sourceType === "url" && "url" in s)
        .map((s) => (s as { url: string }).url)
        .filter(Boolean) || [];

    await sql`
      UPDATE questions
      SET explanation = ${cleanedText},
          explanation_sources = ${JSON.stringify(sourceUrls)}
      WHERE id = ${questionId}
    `;

    await invalidateCache("questions:*");

    console.log(`[api] Saved explanation for question ${questionId}`);
    return c.json({ explanation: cleanedText, sources: sourceUrls });
  }
);

app.post("/api/chat", rateLimit(35, 86400), async (c) => {
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
  console.log(`[api] Chat request with reasoning=${reasoning}, model: ${model}`);

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

app.get("/api/questions", rateLimit(100, 60), async (c) => {
  const topic = c.req.query("topic");

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
    86400
  );

  return c.json(data);
});

const bulkCreateSchema = z.object({
  name: z.string(),
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
      const rowsToInsert = questions.map((q) => ({
        question: q.question,
        options: JSON.stringify(q.options),
        answer: q.answer,
        topic: topic,
      }));

      const result = await sql`
        INSERT INTO questions ${sql(rowsToInsert)}
        RETURNING id
      `;

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
      console.error("[api] Bulk insert error:", error);
      return c.json({ error: "Failed to insert questions" }, 500);
    }
  }
);

export default { port: 8787, fetch: app.fetch };
