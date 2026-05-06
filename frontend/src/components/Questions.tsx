import { useState, useEffect, useRef, useCallback } from "react";
import { Popover } from "@base-ui/react/popover";
import { AnimatePresence, motion } from "motion/react";
import type { Question } from "../types";
import NumberFlow from "@number-flow/react";
import IconFullScreen2 from "@/icons/full-screen";
import IconCheck from "@/icons/check";
import { Drawer } from "vaul";
import { Loader } from "lucide-react";
import {
  ANSWERED_STORAGE_KEY,
  API_URL,
  SET_POSITION_STORAGE_KEY,
} from "@/lib/constants";

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

function getAnsweredQuestions(): Map<number, number> {
  try {
    const stored = localStorage.getItem(ANSWERED_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return new Map();
      }
      return new Map(
        Object.entries(parsed).map(([k, v]) => [Number(k), v as number]),
      );
    }
  } catch (e) {
    console.error("Failed to load answered questions from localStorage:", e);
  }
  return new Map();
}

function saveAnsweredQuestion(questionId: number, selectedIndex: number): void {
  try {
    const answered = getAnsweredQuestions();
    answered.set(questionId, selectedIndex);
    localStorage.setItem(
      ANSWERED_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(answered)),
    );
  } catch (e) {
    console.error("Failed to save answered question to localStorage:", e);
  }
}

interface QuestionsProps {
  questions: Question[];
  setTitle: string;
  onOpenMobileSets?: () => void;
  onCreatePracticeSet?: (
    originalSetName: string,
    wrongQuestions: Question[],
  ) => void;
  isPracticeMode?: boolean;
  progressDeletedFlag?: number;
}

type ExplanationStatus =
  | "processing"
  | "searching"
  | "streaming"
  | "done"
  | "error";

interface ExplanationState {
  questionId: number;
  text: string;
  status: ExplanationStatus;
  visible: boolean;
}

type ExplanationStreamEvent =
  | { type: "status"; value: Exclude<ExplanationStatus, "done" | "error"> }
  | { type: "text"; value: string }
  | { type: "error"; value: string };

export function Questions({
  questions,
  setTitle,
  onOpenMobileSets,
  onCreatePracticeSet,
  isPracticeMode = false,
  progressDeletedFlag = 0,
}: QuestionsProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [answeredQuestions, setAnsweredQuestions] = useState<
    Map<number, number>
  >(() => getAnsweredQuestions());
  const [explanationState, setExplanationState] =
    useState<ExplanationState | null>(null);
  const [showProgressRestored, setShowProgressRestored] = useState(false);
  const [showProgressDeleted, setShowProgressDeleted] = useState(false);
  const [showMobileProgress, setShowMobileProgress] = useState(false);
  const [summaryDrawerOpen, setSummaryDrawerOpen] = useState(false);
  const [goToPopoverOpen, setGoToPopoverOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const prevIndexRef = useRef(currentIndex);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const updateIsDesktop = () => setIsDesktop(media.matches);
    updateIsDesktop();
    media.addEventListener("change", updateIsDesktop);
    return () => media.removeEventListener("change", updateIsDesktop);
  }, []);

  useEffect(() => {
    const positions = getSetPositions();
    const savedIndex = positions[setTitle] ?? 0;
    const validIndex = Math.min(savedIndex, questions.length - 1);
    setCurrentIndex(validIndex >= 0 ? validIndex : 0);
    setSelectedAnswer(null);

    if (validIndex > 0) {
      setShowProgressRestored(true);
      const timeout = setTimeout(() => setShowProgressRestored(false), 1000);
      return () => clearTimeout(timeout);
    }
  }, [setTitle, questions.length]);

  useEffect(() => {
    if (setTitle && questions.length > 0) {
      saveSetPosition(setTitle, currentIndex);
    }
  }, [setTitle, currentIndex, questions.length]);

  useEffect(() => {
    if (prevIndexRef.current !== currentIndex) {
      prevIndexRef.current = currentIndex;
      setShowMobileProgress(true);
      const timeout = setTimeout(() => setShowMobileProgress(false), 1500);
      return () => clearTimeout(timeout);
    }
  }, [currentIndex]);

  useEffect(() => {
    if (progressDeletedFlag > 0) {
      setAnsweredQuestions(new Map());
      setShowProgressDeleted(true);
      const timeout = setTimeout(() => setShowProgressDeleted(false), 1500);
      return () => clearTimeout(timeout);
    }
  }, [progressDeletedFlag]);

  const currentQuestion = questions[currentIndex];
  const isAlreadyAnswered = currentQuestion
    ? isPracticeMode
      ? false
      : answeredQuestions.has(currentQuestion.id)
    : false;
  const previousAnswer = currentQuestion
    ? isPracticeMode
      ? null
      : (answeredQuestions.get(currentQuestion.id) ?? null)
    : null;
  const correctAnswerIndex = currentQuestion?.options.indexOf(
    currentQuestion.answer,
  );

  const isLastQuestion = currentIndex === questions.length - 1;

  const { correctCount, incorrectCount, wrongQuestions } = (() => {
    let correct = 0;
    let incorrect = 0;
    const wrong: Question[] = [];
    for (const q of questions) {
      const userAnswer = answeredQuestions.get(q.id);
      if (userAnswer !== undefined) {
        const correctIdx = q.options.indexOf(q.answer);
        if (userAnswer === correctIdx) {
          correct++;
        } else {
          incorrect++;
          wrong.push(q);
        }
      }
    }
    return {
      correctCount: correct,
      incorrectCount: incorrect,
      wrongQuestions: wrong,
    };
  })();

  const isExplanationForCurrent =
    !!explanationState &&
    !!currentQuestion &&
    explanationState.questionId === currentQuestion.id;
  const isExplanationVisibleHere =
    isExplanationForCurrent && explanationState!.visible;
  const showInlineExplanation = isDesktop && isExplanationVisibleHere;
  const showMobileExplanationDrawer = !isDesktop && isExplanationVisibleHere;
  const explainButtonLabel = (() => {
    if (!isExplanationVisibleHere) return "Explain";
    if (explanationState!.status === "processing") return "Explain (Processing)";
    if (explanationState!.status === "searching") return "Explain (Searching)";
    return "Close";
  })();

  const handleOptionClick = useCallback(
    (index: number) => {
      if (!currentQuestion || selectedAnswer !== null || isAlreadyAnswered) {
        return;
      }
      setSelectedAnswer(index);
      saveAnsweredQuestion(currentQuestion.id, index);
      setAnsweredQuestions((prev) =>
        new Map(prev).set(currentQuestion.id, index),
      );
    },
    [currentQuestion, isAlreadyAnswered, selectedAnswer],
  );

  const startExplanationStream = async (question: Question) => {
    const questionId = question.id;
    setExplanationState({
      questionId,
      text: "",
      status: "processing",
      visible: true,
    });

    try {
      const response = await fetch(`${API_URL}/api/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId,
          question: question.question,
          answer: question.answer,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to get explanation");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";
      let streamFailed = false;

      const handleStreamLine = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as ExplanationStreamEvent;

        if (event.type === "status") {
          console.log(`[explain] ${event.value}`);
          setExplanationState((prev) => {
            if (!prev || prev.questionId !== questionId) return prev;
            return { ...prev, status: event.value };
          });
          return;
        }

        if (event.type === "text") {
          accumulated += event.value;
          setExplanationState((prev) => {
            if (!prev || prev.questionId !== questionId) return prev;
            return { ...prev, text: accumulated, status: "streaming" };
          });
          return;
        }

        streamFailed = true;
        console.error("[explain] stream error:", event.value);
        setExplanationState((prev) => {
          if (!prev || prev.questionId !== questionId) return prev;
          return {
            ...prev,
            status: "error",
            text: "Failed to load explanation. Please try again.",
          };
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          handleStreamLine(line);
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        handleStreamLine(buffer);
      }

      if (!streamFailed) {
        setExplanationState((prev) => {
          if (!prev || prev.questionId !== questionId) return prev;
          return { ...prev, text: accumulated, status: "done" };
        });
      }
    } catch (error) {
      console.error("Error getting explanation:", error);
      setExplanationState((prev) => {
        if (!prev || prev.questionId !== questionId) return prev;
        return {
          ...prev,
          status: "error",
          text: "Failed to load explanation. Please try again.",
        };
      });
    }
  };

  const handleExplain = () => {
    if (!currentQuestion) return;

    const isCurrent =
      explanationState && explanationState.questionId === currentQuestion.id;

    if (isCurrent && explanationState!.visible) {
      setExplanationState({ ...explanationState!, visible: false });
      return;
    }

    if (isCurrent && !explanationState!.visible) {
      setExplanationState({ ...explanationState!, visible: true });
      return;
    }

    if (currentQuestion.explanation) {
      setExplanationState({
        questionId: currentQuestion.id,
        text: currentQuestion.explanation,
        status: "done",
        visible: true,
      });
      return;
    }

    startExplanationStream(currentQuestion);
  };

  const handleExplanationDrawerChange = (open: boolean) => {
    setExplanationState((prev) => {
      if (!prev || !currentQuestion || prev.questionId !== currentQuestion.id) {
        return prev;
      }
      return { ...prev, visible: open };
    });
  };

  const handleNext = useCallback(() => {
    if (currentIndex < questions.length - 1) {
      setDirection(1);
      setCurrentIndex((prev) => prev + 1);
      setSelectedAnswer(null);
    }
  }, [currentIndex, questions.length]);

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      setDirection(-1);
      setCurrentIndex((prev) => prev - 1);
      setSelectedAnswer(null);
    }
  }, [currentIndex]);

  const handleGoToQuestion = useCallback(
    (rawValue: string) => {
      const value = Math.round(Number(rawValue));
      if (!Number.isFinite(value)) return;
      const clamped = Math.min(Math.max(value, 1), questions.length);
      const nextIndex = clamped - 1;
      if (nextIndex !== currentIndex) {
        setDirection(nextIndex > currentIndex ? 1 : -1);
        setCurrentIndex(nextIndex);
        setSelectedAnswer(null);
      }
      setGoToPopoverOpen(false);
    },
    [currentIndex, questions.length],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable='true']") ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      ) {
        return;
      }

      if (/^[1-9]$/.test(e.key)) {
        if (!currentQuestion) return;
        const optionIndex = Number(e.key) - 1;
        if (optionIndex < currentQuestion.options.length) {
          e.preventDefault();
          handleOptionClick(optionIndex);
        }
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrevious();
        return;
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (isLastQuestion && !isPracticeMode) {
          setSummaryDrawerOpen(true);
        } else {
          handleNext();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    currentQuestion,
    handleNext,
    handleOptionClick,
    handlePrevious,
    isLastQuestion,
    isPracticeMode,
  ]);

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
      scale: 0.98,
      transition: { duration: 0.075 },
    }),
  };

  if (!currentQuestion) {
    return <div className="opacity-0">No questions found.</div>;
  }

  const explanationContent = explanationState ? (
    <>
      {explanationState.status === "processing" ||
      explanationState.status === "searching" ? (
        <div className="flex items-center gap-2 text-gray-400 py-2">
          <Loader className="size-4 animate-spin" />
          <span className="text-sm font-medium">
            {explanationState.status === "searching"
              ? "Searching..."
              : "Loading explanation..."}
          </span>
        </div>
      ) : (
        <p
          className={`m-0 whitespace-pre-wrap break-words text-[0.92rem] md:text-base font-medium leading-relaxed ${
            explanationState.status === "error" ? "text-red-500" : "text-[#0A0A0A]"
          }`}
        >
          {explanationState.text}
        </p>
      )}
    </>
  ) : null;

  return (
    <div className="flex flex-col items-center w-full max-w-4xl mx-auto md:mt-3 pt-4 p-6 pb-8 md:pt-6 h-full min-h-0 overflow-hidden">
      <div className="w-full shrink-0">
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
            <h2 className="text-[0.92rem] md:text-xl font-medium leading-normal mb-6 md:mb-7">
              {currentQuestion.question}
            </h2>

            <div className="grid gap-2 md:gap-3">
              {currentQuestion.options.map((option, index) => {
                const isSelected = selectedAnswer === index;
                const isCorrect = index === correctAnswerIndex;
                const wasPreviouslySelected = previousAnswer === index;
                const previousWasCorrect =
                  previousAnswer === correctAnswerIndex;

                const showCorrect =
                  (selectedAnswer !== null && isCorrect) ||
                  (isAlreadyAnswered && isCorrect);
                const showIncorrect =
                  (selectedAnswer !== null && isSelected && !isCorrect) ||
                  (isAlreadyAnswered &&
                    wasPreviouslySelected &&
                    !previousWasCorrect);

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
                    <p className="text-[0.9rem] md:text-base">{option}</p>
                  </div>
                );
              })}
            </div>
            <div className="flex w-full pl-2 pt-1 md:mt-6 gap-6">
              <button
                type="button"
                onClick={handleExplain}
                className="flex items-center gap-2 border-0 !bg-transparent p-0 text-[15px] md:text-base cursor-pointer font-rounded font-semibold text-gray-500 hover:!bg-transparent hover:text-gray-700 active:!bg-transparent focus:!bg-transparent appearance-none [&_svg]:!bg-transparent"
              >
                <IconFullScreen2 size="16px" />
                {explainButtonLabel}
              </button>
              {isAlreadyAnswered && (
                <div className="flex text-[15px] md:text-base items-center gap-2 font-rounded font-medium text-[#31903f]">
                  <IconCheck size="16px" strokeWidth={4} color="#31903f" />
                  Already answered
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {showInlineExplanation && (
        <div className="flex-1 basis-0 min-h-0 w-full mt-2 overflow-y-auto overscroll-contain px-2">
          {explanationContent}
        </div>
      )}

      <div
        className="flex shrink-0 gap-4 pt-0 md:pt-4 mt-auto items-center"
        style={{ fontWeight: 700 }}
      >
        <button
          onClick={handlePrevious}
          disabled={currentIndex === 0}
          style={{ padding: "0.6em 1.2em" }}
          className={`
            w-[7.2rem] md:w-36 focus:outline-none border-none outline-none active:outline-none focus-visible:outline-none button-3
            ${
              currentIndex === 0
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer"
            }
          `}
        >
          <p>Prev</p>
        </button>
        <button
          onClick={onOpenMobileSets}
          style={{ padding: "0.5em 1em" }}
          className="md:hidden button-3 opacity-65 cursor-pointer min-w-18"
        >
          <AnimatePresence mode="popLayout">
            {showMobileProgress ? (
              <motion.span
                key="progress"
                initial={{ opacity: 0, scale: 0.9, filter: "blur(2px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.9, filter: "blur(2px)" }}
                transition={{ duration: 0.2 }}
                className="font-semibold tabular-nums text-sm"
              >
                {currentIndex + 1}
              </motion.span>
            ) : (
              <motion.span
                key="sets"
                initial={{ opacity: 0, scale: 0.9, filter: "blur(2px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.9, filter: "blur(2px)" }}
                transition={{ duration: 0.2 }}
                className="font-medium text-sm"
              >
                Sets
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        <div className="relative hidden md:flex flex-col items-center">
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
            {showProgressDeleted && (
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
                className="absolute -top-14 text-sm font-medium text-red-600 whitespace-nowrap"
              >
                Progress Deleted
              </motion.div>
            )}
          </AnimatePresence>
          <Popover.Root
            open={goToPopoverOpen}
            onOpenChange={setGoToPopoverOpen}
          >
            <Popover.Trigger
              id="progress-container"
              className="font-semibold tabular-nums font-rounded opacity-70 w-20 hidden md:flex items-center justify-center cursor-pointer bg-white!"
            >
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
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner side="top" sideOffset={14}>
                <Popover.Popup className="bg-white rounded-lg shadow-lg border border-gray-200 px-3.5 py-2 origin-bottom transition-all duration-250 ease-[cubic-bezier(0.23,1,0.32,1)] will-change-[transform,opacity,filter] data-starting-style:opacity-0 data-starting-style:scale-90 data-starting-style:blur-[1.5px] data-ending-style:opacity-0 data-ending-style:scale-85 data-ending-style:blur-[2px]">
                  <Popover.Arrow className="data-[side=top]:bottom-[-10px] data-[side=bottom]:top-[-10px] data-[side=left]:right-[-10px] data-[side=right]:left-[-10px]">
                    <svg
                      width="20"
                      height="10"
                      viewBox="0 0 20 10"
                      fill="none"
                      className="rotate-180 -translate-y-[2.5px] will-change-transform"
                    >
                      <path
                        d="M9.66437 2.60207L4.80758 6.97318C4.07308 7.63423 3.11989 8 2.13172 8H0V10H20V8H18.5349C17.5468 8 16.5936 7.63423 15.8591 6.97318L11.0023 2.60207C10.622 2.2598 10.0447 2.25979 9.66437 2.60207Z"
                        className="fill-white"
                      />
                      <path
                        d="M8.99542 1.85876C9.75604 1.17425 10.9106 1.17422 11.6713 1.85878L16.5281 6.22989C17.0789 6.72568 17.7938 7.00001 18.5349 7.00001L15.89 7L11.0023 2.60207C10.622 2.2598 10.0447 2.2598 9.66436 2.60207L4.77734 7L2.13171 7.00001C2.87284 7.00001 3.58774 6.72568 4.13861 6.22989L8.99542 1.85876Z"
                        className="fill-gray-200"
                      />
                      <path
                        d="M10.3333 3.34539L5.47654 7.71648C4.55842 8.54279 3.36693 9 2.13172 9H0V8H2.13172C3.11989 8 4.07308 7.63423 4.80758 6.97318L9.66437 2.60207C10.0447 2.25979 10.622 2.2598 11.0023 2.60207L15.8591 6.97318C16.5936 7.63423 17.5468 8 18.5349 8H20V9H18.5349C17.2998 9 16.1083 8.54278 15.1901 7.71648L10.3333 3.34539Z"
                        className="fill-white"
                      />
                    </svg>
                  </Popover.Arrow>
                  <div className="font-rounded font-semibold text-sm bg-white!">
                    Go to{" "}
                    <input
                      type="number"
                      inputMode="numeric"
                      autoFocus
                      className="border-shadow ml-1 rounded-sm px-1 py-0.25 focus:outline-none min-w-4"
                      min={1}
                      max={questions.length}
                      style={{ fieldSizing: "content" }}
                      onBlur={() => setGoToPopoverOpen(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleGoToQuestion(e.currentTarget.value);
                        }
                      }}
                    />
                  </div>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
          <div
            id="progress-container-mobile"
            className="font-semibold tabular-nums font-rounded opacity-70 w-20 flex md:hidden items-center justify-center"
          >
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
          onClick={
            isLastQuestion && !isPracticeMode
              ? () => setSummaryDrawerOpen(true)
              : handleNext
          }
          disabled={isLastQuestion && isPracticeMode}
          style={{ padding: "0.6em 1.2em" }}
          className={`
            w-[7.2rem] md:w-36 focus:outline-none border-none outline-none active:outline-none focus-visible:outline-none
            ${
              isLastQuestion && isPracticeMode
                ? "cursor-not-allowed opacity-50 button-3"
                : isLastQuestion
                  ? "cursor-pointer button-summary"
                  : "cursor-pointer button-3"
            }
          `}
        >
          <p>{isLastQuestion && !isPracticeMode ? "Summary" : "Next"}</p>
        </button>
      </div>

      {!isDesktop && (
        <Drawer.Root
          open={showMobileExplanationDrawer}
          onOpenChange={handleExplanationDrawerChange}
          shouldScaleBackground
        >
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-black/40" />
            <Drawer.Content className="fixed bottom-0 left-0 right-0 h-[76vh] bg-white rounded-t-xl outline-none flex flex-col">
              <div className="mx-auto w-12 h-1.5 shrink-0 rounded-full bg-gray-300 mt-4 mb-2" />
              <Drawer.Title className="sr-only">Explanation</Drawer.Title>
              <Drawer.Description className="sr-only">
                Explanation for the current question.
              </Drawer.Description>
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 pb-8 pt-2">
                {explanationContent}
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      )}

      <Drawer.Root
        open={summaryDrawerOpen}
        onOpenChange={setSummaryDrawerOpen}
        shouldScaleBackground
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 bg-white rounded-t-xl outline-none flex flex-col">
            <div className="mx-auto w-12 h-1.5 shrink-0 rounded-full bg-gray-300 mt-4 mb-2" />
            <Drawer.Title className="sr-only">Summary</Drawer.Title>
            <Drawer.Description className="sr-only">
              Summary of your answers for this question set.
            </Drawer.Description>

            <div className="flex flex-col items-center justify-center py-12 px-6">
              <div className="flex flex-col gap-3 text-lg font-semibold font-rounded">
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 w-32">Correct:</span>
                  <span style={{ color: "#45c858" }}>
                    {correctCount}/{questions.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 w-32">Incorrect:</span>
                  <span style={{ color: "#eb5a53" }}>
                    {incorrectCount}/{questions.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 w-32">Unanswered:</span>
                  <span className="text-gray-600">
                    {questions.length - correctCount - incorrectCount}/
                    {questions.length}
                  </span>
                </div>
              </div>

              <button
                onClick={() => {
                  setSummaryDrawerOpen(false);
                  if (onCreatePracticeSet && wrongQuestions.length > 0) {
                    onCreatePracticeSet(setTitle, wrongQuestions);
                  }
                }}
                disabled={wrongQuestions.length === 0}
                className={`button-practice mt-8 px-6 py-3 font-semibold ${
                  wrongQuestions.length === 0
                    ? "opacity-50 cursor-not-allowed"
                    : ""
                }`}
              >
                Practice wrong only
              </button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
