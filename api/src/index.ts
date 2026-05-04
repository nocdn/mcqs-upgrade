import { Hono } from "hono";
import { cors } from "hono/cors";
import { sql } from "./db";
import { getCached, invalidateCache, checkRateLimit } from "./redis";
import { z } from "zod";
import { validator } from "hono/validator";
import { streamText, tool, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import type { Context, Next } from "hono";

function intFromEnv(name: string, fallback: number, min: number, max?: number) {
  const parsed = parseInt(process.env[name] || "", 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max ?? value, Math.max(min, value));
}

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const OPENAI_REASONING_EFFORT = (process.env.OPENAI_REASONING_EFFORT ||
  "high") as "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
const EXA_SEARCH_TYPE = process.env.EXA_SEARCH_TYPE || "auto";
const EXPLAIN_MAX_SEARCHES = intFromEnv("EXPLAIN_MAX_SEARCHES", 10, 1, 10);
const EXPLAIN_RESULTS_PER_SEARCH = intFromEnv(
  "EXPLAIN_RESULTS_PER_SEARCH",
  5,
  1,
  100
);
const EXPLAIN_MAX_CHARS = intFromEnv("EXPLAIN_MAX_CHARS", 35000, 100);
const EXPLAIN_TRACE_LOGS = process.env.EXPLAIN_TRACE_LOGS !== "false";
const EXPLAIN_LOG_SNIPPET_CHARS = intFromEnv(
  "EXPLAIN_LOG_SNIPPET_CHARS",
  260,
  40,
  2000
);

function logExplainTrace(message: string) {
  if (EXPLAIN_TRACE_LOGS) {
    console.log(message);
  }
}

function compactForLog(value: string, maxChars = EXPLAIN_LOG_SNIPPET_CHARS) {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxChars) return compacted;
  return `${compacted.slice(0, maxChars)}...`;
}

interface ExaResult {
  title?: string;
  url?: string;
  text?: string;
  publishedDate?: string | null;
  author?: string | null;
}

async function exaSearch(query: string): Promise<ExaResult[]> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error("EXA_API_KEY is not set");
  }
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      type: EXA_SEARCH_TYPE,
      numResults: EXPLAIN_RESULTS_PER_SEARCH,
      contents: {
        text: { maxCharacters: EXPLAIN_MAX_CHARS },
      },
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Exa search failed (${response.status}): ${body}`);
  }
  const data = (await response.json()) as { results?: ExaResult[] };
  return data.results || [];
}

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
  topic: string,
  parentSet?: string
) {
  try {
    const [newQuestion] = await sql`
      INSERT INTO questions (question, options, answer, topic, parent_set)
      VALUES (${questionText}, ${JSON.stringify(
      options
    )}, ${answer}, ${topic}, ${parentSet || null})
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

    const encoder = new TextEncoder();

    function sendEvent(
      controller: ReadableStreamDefaultController<Uint8Array>,
      event:
        | { type: "status"; value: "processing" | "searching" | "streaming" }
        | { type: "text"; value: string }
        | { type: "error"; value: string }
    ) {
      controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
    }

    if (existing?.explanation) {
      console.log(
        `[explain] Cached explanation found for question ${questionId} - returning without LLM call`
      );
      const cached = existing.explanation as string;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          sendEvent(controller, { type: "text", value: cached });
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    console.log(
      `[explain] Starting agentic explanation for question ${questionId}`
    );
    console.log(
      `[explain] Config: model=${OPENAI_MODEL}, reasoningEffort=${OPENAI_REASONING_EFFORT}, searchType=${EXA_SEARCH_TYPE}, maxSearches=${EXPLAIN_MAX_SEARCHES}, resultsPerSearch=${EXPLAIN_RESULTS_PER_SEARCH}, maxChars=${EXPLAIN_MAX_CHARS}, traceLogs=${EXPLAIN_TRACE_LOGS}, logSnippetChars=${EXPLAIN_LOG_SNIPPET_CHARS}`
    );

    const defaultSystemPrompt = `You are a careful research assistant whose job is to explain why a given answer to a quiz question is correct.

You have access to one tool, "search", which queries Exa AI's web search and returns up to ${EXPLAIN_RESULTS_PER_SEARCH} results per call with text excerpts (capped at ${EXPLAIN_MAX_CHARS} characters per result).

Workflow:
1. First, plan what authoritative information you need.
2. You must call the "search" tool at least once before writing the final explanation. Issue one or more focused search queries. You may call it up to ${EXPLAIN_MAX_SEARCHES} times in total. Reuse it for follow-up queries when you need to verify or fill gaps.
3. Once you have enough grounding, write the final explanation directly as your assistant message text.

Output rules for the final explanation:
- Plain text only. Do NOT use any markdown formatting (no #, *, _, lists, code fences, etc.).
- Do NOT prefix the answer with "Explanation:" or similar - start with the explanation itself.
- Be concise and accurate. Cite multiple sources naturally inside the prose (e.g. "according to ...").
- Do NOT mention the search tool, your plan, or your reasoning - only the explanation.`;

    const systemPrompt =
      process.env.EXPLAIN_SYSTEM_PROMPT || defaultSystemPrompt;

    const userPrompt = `Question: "${question}"\n\nCorrect answer: "${answer}"\n\nPlease explain why this answer is correct.`;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let searchCount = 0;
        let collectedText = "";
        let streamedLogBuffer = "";
        let lastStatus: "processing" | "searching" | "streaming" | null = null;

        const setStatus = (
          status: "processing" | "searching" | "streaming"
        ) => {
          if (lastStatus === status) return;
          lastStatus = status;
          console.log(`[explain] Status -> ${status}`);
          sendEvent(controller, { type: "status", value: status });
        };

        setStatus("processing");

        try {
          const result = streamText({
            model: openai(OPENAI_MODEL),
            providerOptions: {
              openai: {
                reasoningEffort: OPENAI_REASONING_EFFORT,
              },
            },
            system: systemPrompt,
            prompt: userPrompt,
            stopWhen: stepCountIs(EXPLAIN_MAX_SEARCHES + 1),
            prepareStep: ({ steps }) =>
              steps.length === 0 ? { toolChoice: "required" } : undefined,
            tools: {
              search: tool({
                description:
                  "Search the web via Exa AI. Use this to gather authoritative context before writing the final explanation. You may call this multiple times.",
                inputSchema: z.object({
                  query: z
                    .string()
                    .describe(
                      "A focused natural-language search query for Exa."
                    ),
                }),
                execute: async ({ query }) => {
                  if (searchCount >= EXPLAIN_MAX_SEARCHES) {
                    console.log(
                      `[explain] Search limit reached (${EXPLAIN_MAX_SEARCHES}); rejecting extra tool call`
                    );
                    return {
                      error: `Search limit reached (${EXPLAIN_MAX_SEARCHES})`,
                    };
                  }
                  searchCount++;
                  logExplainTrace(
                    `[explain] Tool call #${searchCount}/${EXPLAIN_MAX_SEARCHES}: search query="${compactForLog(query)}"`
                  );
                  setStatus("searching");
                  try {
                    const results = await exaSearch(query);
                    console.log(
                      `[explain] Search #${searchCount} returned ${results.length} result(s)`
                    );
                    results.forEach((result, index) => {
                      logExplainTrace(
                        `[explain] Search #${searchCount} result ${index + 1}: title="${compactForLog(
                          result.title || "Untitled",
                          140
                        )}" url=${result.url || "unknown"} textChars=${
                          result.text?.length || 0
                        }`
                      );
                      if (result.text) {
                        logExplainTrace(
                          `[explain] Search #${searchCount} result ${
                            index + 1
                          } text preview="${compactForLog(result.text)}"`
                        );
                      }
                    });
                    return results.map((r) => ({
                      title: r.title || "",
                      url: r.url || "",
                      publishedDate: r.publishedDate || null,
                      author: r.author || null,
                      text: r.text || "",
                    }));
                  } catch (err) {
                    const msg =
                      err instanceof Error ? err.message : String(err);
                    console.log(
                      `[explain] Search #${searchCount} failed: ${msg}`
                    );
                    return { error: msg };
                  }
                },
              }),
            },
          });

          for await (const part of result.fullStream) {
            switch (part.type) {
              case "tool-call":
                logExplainTrace(
                  `[explain] Model issued tool call: ${part.toolName}`
                );
                setStatus("searching");
                break;
              case "tool-result":
                logExplainTrace(`[explain] Tool result delivered to model`);
                setStatus("processing");
                break;
              case "tool-error": {
                const msg =
                  (part as { error?: unknown }).error instanceof Error
                    ? (part as { error: Error }).error.message
                    : String((part as { error?: unknown }).error ?? "unknown");
                console.log(`[explain] Tool error delivered to model: ${msg}`);
                setStatus("processing");
                break;
              }
              case "text-delta": {
                const delta =
                  (part as { text?: string; delta?: string }).text ??
                  (part as { text?: string; delta?: string }).delta ??
                  "";
                if (!delta) break;
                setStatus("streaming");
                collectedText += delta;
                streamedLogBuffer += delta;
                if (streamedLogBuffer.length >= EXPLAIN_LOG_SNIPPET_CHARS) {
                  logExplainTrace(
                    `[explain] Model output preview: "${compactForLog(
                      streamedLogBuffer
                    )}"`
                  );
                  streamedLogBuffer = "";
                }
                sendEvent(controller, { type: "text", value: delta });
                break;
              }
              case "error": {
                const msg =
                  (part as { error?: unknown }).error instanceof Error
                    ? ((part as { error: Error }).error.message)
                    : String((part as { error?: unknown }).error ?? "unknown");
                console.log(`[explain] Stream error event: ${msg}`);
                sendEvent(controller, { type: "error", value: msg });
                break;
              }
              case "finish":
                if (streamedLogBuffer.trim()) {
                  logExplainTrace(
                    `[explain] Model output preview: "${compactForLog(
                      streamedLogBuffer
                    )}"`
                  );
                  streamedLogBuffer = "";
                }
                console.log(`[explain] Model finished generating`);
                break;
              default:
                break;
            }
          }

          const finalText = collectedText.trim();
          console.log(
            `[explain] Total searches: ${searchCount}. Final text length: ${finalText.length} chars`
          );
          if (finalText) {
            logExplainTrace(
              `[explain] Final explanation preview: "${compactForLog(
                finalText,
                Math.min(EXPLAIN_LOG_SNIPPET_CHARS * 2, 1200)
              )}"`
            );
          }

          if (finalText) {
            try {
              await sql`
                UPDATE questions
                SET explanation = ${finalText},
                    explanation_sources = ${JSON.stringify([])}
                WHERE id = ${questionId}
              `;
              await invalidateCache("questions:*");
              console.log(
                `[explain] Saved explanation for question ${questionId}`
              );
            } catch (err) {
              console.log(
                `[explain] DB save failed: ${
                  err instanceof Error ? err.message : String(err)
                }`
              );
            }
          } else {
            console.log(`[explain] No text produced - skipping DB save`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`[explain] Fatal error: ${msg}`);
          sendEvent(controller, { type: "error", value: msg });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
);

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
          parent_set: string | null;
          explanation: string | null;
          explanation_sources: unknown;
        }[]
      >`
        SELECT id, question, options, answer, topic, parent_set, explanation, explanation_sources
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
        parentSet: r.parent_set,
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
  parent_set: z.string().optional(),
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
    const { name: topic, parent_set: parentSet, questions } = c.req.valid("json");

    if (questions.length === 0) {
      return c.json({ message: "No questions provided" }, 400);
    }

    try {
      const rowsToInsert = questions.map((q) => ({
        question: q.question,
        options: JSON.stringify(q.options),
        answer: q.answer,
        topic: topic,
        parent_set: parentSet || null,
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
