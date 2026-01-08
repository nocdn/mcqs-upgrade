import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Question } from "../types";
import NumberFlow from "@number-flow/react";
import IconFullScreen2 from "@/icons/full-screen";
import IconCheck from "@/icons/check";
import { Drawer } from "vaul";
import { Loader2, CornerDownLeft } from "lucide-react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Markdown from "react-markdown";
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

const ANSWERED_STORAGE_KEY = "mcqs-answered-questions";
const SET_POSITION_STORAGE_KEY = "mcqs-set-positions";

function getSetPositions(): Record<string, number> {
  try {
    const stored = localStorage.getItem(SET_POSITION_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error("Failed to load set positions from localStorage:", e);
  }
  return {};
}

function saveSetPosition(setTitle: string, index: number): void {
  try {
    const positions = getSetPositions();
    positions[setTitle] = index;
    localStorage.setItem(SET_POSITION_STORAGE_KEY, JSON.stringify(positions));
  } catch (e) {
    console.error("Failed to save set position to localStorage:", e);
  }
}

function getAnsweredQuestions(): Set<number> {
  try {
    const stored = localStorage.getItem(ANSWERED_STORAGE_KEY);
    if (stored) {
      return new Set(JSON.parse(stored));
    }
  } catch (e) {
    console.error("Failed to load answered questions from localStorage:", e);
  }
  return new Set();
}

function saveAnsweredQuestion(questionId: number): void {
  try {
    const answered = getAnsweredQuestions();
    answered.add(questionId);
    localStorage.setItem(ANSWERED_STORAGE_KEY, JSON.stringify([...answered]));
  } catch (e) {
    console.error("Failed to save answered question to localStorage:", e);
  }
}

interface QuestionsProps {
  questions: Question[];
  setTitle: string;
}

export function Questions({ questions, setTitle }: QuestionsProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [answeredQuestions, setAnsweredQuestions] = useState<Set<number>>(() =>
    getAnsweredQuestions()
  );
  const [explainDialogOpen, setExplainDialogOpen] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explanationSources, setExplanationSources] = useState<string[]>([]);
  const [loadingExplanation, setLoadingExplanation] = useState(false);
  const [thinkHarder, setThinkHarder] = useState(false);
  const [showProgressRestored, setShowProgressRestored] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: `${API_URL}/api/chat`,
      body: {
        reasoning: thinkHarder,
        explanationContext: explanation,
      },
    }),
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Restore position when set changes
  useEffect(() => {
    const positions = getSetPositions();
    const savedIndex = positions[setTitle] ?? 0;
    // Ensure saved index is valid for current questions array
    const validIndex = Math.min(savedIndex, questions.length - 1);
    setCurrentIndex(validIndex >= 0 ? validIndex : 0);
    setSelectedAnswer(null);

    // Show "Progress Restored" message if we restored to a non-zero position
    if (validIndex > 0) {
      setShowProgressRestored(true);
      const timeout = setTimeout(() => setShowProgressRestored(false), 1000);
      return () => clearTimeout(timeout);
    }
  }, [setTitle, questions.length]);

  // Save position whenever it changes
  useEffect(() => {
    if (setTitle && questions.length > 0) {
      saveSetPosition(setTitle, currentIndex);
    }
  }, [setTitle, currentIndex, questions.length]);

  const currentQuestion = questions[currentIndex];
  const isAlreadyAnswered = currentQuestion
    ? answeredQuestions.has(currentQuestion.id)
    : false;
  const correctAnswerIndex = currentQuestion?.options.indexOf(
    currentQuestion.answer
  );

  const handleOptionClick = (index: number) => {
    if (selectedAnswer === null && !isAlreadyAnswered) {
      setSelectedAnswer(index);
      // Save to localStorage
      saveAnsweredQuestion(currentQuestion.id);
      setAnsweredQuestions((prev) => new Set([...prev, currentQuestion.id]));
    }
  };

  const handleExplain = async () => {
    if (!currentQuestion) return;

    // Open dialog immediately
    setExplainDialogOpen(true);
    setLoadingExplanation(true);
    setExplanation(null);
    setExplanationSources([]);
    setMessages([]); // Reset chat messages when opening

    // Check if we already have explanation from the fetched data
    if (currentQuestion.explanation) {
      setExplanation(currentQuestion.explanation);
      setExplanationSources(currentQuestion.explanationSources || []);
      setLoadingExplanation(false);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/explain`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          questionId: currentQuestion.id,
          question: currentQuestion.question,
          answer: currentQuestion.answer,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get explanation");
      }

      const data = await response.json();
      setExplanation(data.explanation);
      setExplanationSources(data.sources || []);
    } catch (error) {
      console.error("Error getting explanation:", error);
      setExplanation("Failed to load explanation. Please try again.");
    } finally {
      setLoadingExplanation(false);
    }
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setDirection(1);
      setCurrentIndex((prev) => prev + 1);
      setSelectedAnswer(null);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setDirection(-1);
      setCurrentIndex((prev) => prev - 1);
      setSelectedAnswer(null);
    }
  };

  const variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 20 : -20,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 20 : -20,
      opacity: 0,
      filter: "blur(1px)",
      scale: 0.98,
      transition: { duration: 0.075 },
    }),
  };

  if (!currentQuestion) {
    return <div className="opacity-0">No questions found.</div>;
  }

  return (
    <div className="flex flex-col items-center w-full max-w-3xl mx-auto mt-8 p-6 space-y-8 h-full">
      <div className="w-full space-y-6">
        <AnimatePresence mode="popLayout" custom={direction}>
          <motion.div
            key={currentIndex}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            className="space-y-4"
          >
            <h2 className="text-xl font-medium leading-normal mb-10">
              {currentQuestion.question}
            </h2>

            <div className="grid gap-3">
              {currentQuestion.options.map((option, index) => {
                const isSelected = selectedAnswer === index;
                const isCorrect = index === correctAnswerIndex;
                const showCorrect =
                  (selectedAnswer !== null && isCorrect) ||
                  (isAlreadyAnswered && isCorrect);
                const showIncorrect =
                  selectedAnswer !== null && isSelected && !isCorrect;

                let buttonClass = "button-3";
                if (showCorrect) {
                  buttonClass = "button-correct";
                } else if (showIncorrect) {
                  buttonClass = "button-incorrect";
                }

                const isClickable =
                  !isAlreadyAnswered && selectedAnswer === null;

                return (
                  <div
                    key={index}
                    onClick={() => handleOptionClick(index)}
                    className={`flex items-center gap-3 px-3 py-2.5 font-medium ${buttonClass} font-inter rounded-lg transition-colors ${
                      isClickable ? "cursor-pointer" : "cursor-default"
                    }`}
                  >
                    <div className="border-[2.5px] border-[#f3f3f3] text-gray-300 font-semibold font-rounded flex items-center justify-center size-8 rounded-lg shrink-0">
                      {String.fromCharCode(65 + index)}
                    </div>
                    <p>{option}</p>
                  </div>
                );
              })}
            </div>
            <div className="flex w-full pl-2 mt-8 gap-6">
              <div
                onMouseDown={handleExplain}
                className="flex items-center gap-2 cursor-pointer font-rounded font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                <IconFullScreen2 size="16px" />
                Explain
              </div>
              {isAlreadyAnswered && (
                <div className="flex items-center gap-1.5 font-rounded font-medium text-[#5686FE]">
                  <IconCheck size="16px" strokeWidth={4} />
                  Already answered
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div
        className="flex gap-4 pt-4 mt-auto items-center"
        style={{ fontWeight: 700 }}
      >
        <button
          onClick={handlePrevious}
          disabled={currentIndex === 0}
          style={{ padding: "0.6em 1.2em" }}
          className={`
            w-36 focus:outline-none border-none outline-none active:outline-none focus-visible:outline-none button-3
            ${
              currentIndex === 0
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer"
            }
          `}
        >
          <p>Prev</p>
        </button>
        <div className="relative flex flex-col items-center">
          <AnimatePresence>
            {showProgressRestored && (
              <motion.div
                initial={{
                  y: 6,
                  opacity: 0,
                  scale: 0.9,
                  filter: "blur(1.5px)",
                }}
                animate={{
                  y: 0,
                  opacity: 1,
                  scale: 1,
                  filter: "blur(0px)",
                }}
                exit={{
                  y: 9,
                  opacity: 0,
                  scale: 0.85,
                  filter: "blur(2px)",
                }}
                transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                className="absolute -top-14 text-sm font-medium text-blue-600 whitespace-nowrap"
              >
                Progress Restored
              </motion.div>
            )}
          </AnimatePresence>
          <div className="font-semibold tabular-nums font-rounded opacity-70">
            <NumberFlow
              value={currentIndex + 1}
              transformTiming={{
                duration: 260,
                easing:
                  "linear(0, 0.0018, 0.0069 1.16%, 0.0262 2.32%, 0.0642, 0.1143 5.23%, 0.2244 7.84%, 0.5881 15.68%, 0.6933, 0.7839, 0.8591, 0.9191 26.13%, 0.9693, 1.0044 31.93%, 1.0234, 1.0358 36.58%, 1.0434 39.19%, 1.046 42.39%, 1.0446 44.71%, 1.0404 47.61%, 1.0118 61.84%, 1.0028 69.39%, 0.9981 80.42%, 0.9991 99.87%)",
              }}
            />{" "}
            <span className="ml-1 mr-2 opacity-30">/</span>
            {questions.length}
          </div>
        </div>
        <button
          onClick={handleNext}
          disabled={currentIndex === questions.length - 1}
          style={{ padding: "0.6em 1.2em" }}
          className={`
            w-36 focus:outline-none border-none outline-none active:outline-none focus-visible:outline-none button-3
            ${
              currentIndex === questions.length - 1
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer"
            }
          `}
        >
          <p>Next</p>
        </button>
      </div>

      {/* Explanation Drawer */}
      <Drawer.Root
        open={explainDialogOpen}
        onOpenChange={setExplainDialogOpen}
        shouldScaleBackground
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 h-[89vh] bg-white rounded-t-xl outline-none flex flex-col">
            <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-gray-300 mt-4 mb-2" />
            <Drawer.Title className="sr-only">Explanation</Drawer.Title>

            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto px-6 pb-4">
              {/* Initial Explanation */}
              {loadingExplanation ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-gray-400" />
                </div>
              ) : explanation ? (
                <div className="prose prose-sm max-w-none">
                  <Markdown>{explanation}</Markdown>

                  {/* Sources */}
                  {explanationSources.length > 0 && (
                    <div className="mt-6 pt-4 border-t border-gray-100">
                      <p className="text-xs font-medium text-gray-500 mb-2">
                        Sources
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {explanationSources.map((source, idx) => (
                          <a
                            key={idx}
                            href={source}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center size-6 rounded-full bg-gray-100 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors no-underline"
                          >
                            {idx + 1}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Chat Messages */}
              {messages.length > 0 && (
                <div className="mt-6 pt-4 border-t border-gray-100 space-y-4">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`${
                        message.role === "user"
                          ? "ml-auto bg-gray-100 rounded-2xl px-4 py-2 max-w-[85%] w-fit"
                          : "prose prose-sm max-w-none"
                      }`}
                    >
                      {message.role === "user" ? (
                        <p className="text-sm">
                          {message.parts?.find((p) => p.type === "text")
                            ?.text || ""}
                        </p>
                      ) : (
                        <>
                          <Markdown>
                            {message.parts
                              ?.filter((p) => p.type === "text")
                              .map(
                                (p) =>
                                  (p as { type: "text"; text: string }).text
                              )
                              .join("") || ""}
                          </Markdown>
                          {(() => {
                            const sources =
                              message.parts
                                ?.filter((p) => p.type === "source-url")
                                .map(
                                  (p) =>
                                    (p as { type: "source-url"; url: string })
                                      .url
                                ) || [];
                            if (sources.length === 0) return null;
                            return (
                              <div className="mt-3 pt-3 border-t border-gray-100 not-prose">
                                <p className="text-xs font-medium text-gray-500 mb-2">
                                  Sources
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {sources.map((source, idx) => (
                                    <a
                                      key={idx}
                                      href={source}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center justify-center size-6 rounded-full bg-gray-100 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors no-underline"
                                    >
                                      {idx + 1}
                                    </a>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  ))}
                  {status === "streaming" &&
                    messages[messages.length - 1]?.role !== "assistant" && (
                      <div className="flex items-center gap-2 text-gray-400">
                        <Loader2 className="size-4 animate-spin" />
                        <span className="text-sm">Thinking...</span>
                      </div>
                    )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Chat Input */}
            <div className="px-6 py-4 border-t border-gray-100 bg-white">
              <PromptInput
                onSubmit={(message: PromptInputMessage) => {
                  if (message.text?.trim()) {
                    sendMessage({ text: message.text });
                  }
                }}
                className="border rounded-xl"
              >
                <PromptInputBody>
                  <PromptInputTextarea
                    placeholder="Ask a follow-up question..."
                    disabled={loadingExplanation}
                  />
                </PromptInputBody>
                <PromptInputFooter>
                  <PromptInputTools>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="think-harder"
                        checked={thinkHarder}
                        onCheckedChange={(checked) => {
                          const val = Boolean(checked);
                          setThinkHarder(val);
                          console.log("Think Harder toggled:", val);
                        }}
                      />
                      <Label
                        htmlFor="think-harder"
                        className="text-sm font-medium text-gray-600 cursor-pointer select-none"
                      >
                        Think Harder
                      </Label>
                    </div>
                  </PromptInputTools>
                  <button
                    type="submit"
                    disabled={loadingExplanation || status !== "ready"}
                    className="flex items-center justify-center rounded-xl transition-opacity disabled:opacity-60 text-white"
                    style={{ backgroundColor: "#006BFF", padding: "8px 8px" }}
                  >
                    {status === "streaming" ? (
                      <Loader2 className="size-4 text-white animate-spin" />
                    ) : (
                      <>
                        <CornerDownLeft className="size-4" />
                      </>
                    )}
                  </button>
                </PromptInputFooter>
              </PromptInput>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
