import { Questions } from "@/components/Questions";
import { useState, useEffect, useMemo, useCallback } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X, Settings } from "lucide-react";
import { Drawer } from "vaul";
import type { Question, ApiResponse } from "./types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";
const IS_DEV = import.meta.env.DEV;

const ANSWERED_STORAGE_KEY = "mcqs-answered-questions";

const PLACEHOLDER_QUESTIONS: Question[] = [
  {
    id: 900001,
    question: "What is the primary purpose of a literature review in research?",
    options: [
      "To summarize all existing knowledge",
      "To identify gaps and position your study",
      "To prove your hypothesis is correct",
      "To list all authors in your field",
    ],
    answer: "To identify gaps and position your study",
    topic: "SPID",
  },
];

function isMobileDevice(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

async function generateFingerprint(): Promise<string> {
  const data = [
    navigator.userAgent,
    navigator.language,
    screen.width,
    screen.height,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
  ].join("|");
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(data)
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function logVisit() {
  try {
    const fingerprint = await generateFingerprint();
    await fetch(`${API_URL}/api/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint }),
    });
  } catch {
    // Silently fail - logging is not critical
  }
}

interface PracticeSet {
  name: string;
  questions: Question[];
}

const SELECTED_SET_STORAGE_KEY = "mcqs-selected-set";

function getStoredSelectedSet(): string | null {
  try {
    return localStorage.getItem(SELECTED_SET_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveSelectedSet(setName: string): void {
  try {
    localStorage.setItem(SELECTED_SET_STORAGE_KEY, setName);
  } catch {
    // Silently fail
  }
}

function App() {
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSet, setSelectedSet] = useState<string | null>(null);
  const [showingSets, setShowingSets] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [practiceSets, setPracticeSets] = useState<PracticeSet[]>([]);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [progressDeletedFlag, setProgressDeletedFlag] = useState(0);

  useEffect(() => {
    logVisit();
  }, []);

  useEffect(() => {
    async function fetchQuestions() {
      if (IS_DEV && isMobileDevice() && !import.meta.env.VITE_API_URL) {
        setAllQuestions(PLACEHOLDER_QUESTIONS);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const response = await fetch(`${API_URL}/api/questions`);
        if (!response.ok) {
          throw new Error("Failed to fetch questions");
        }
        const data: ApiResponse = await response.json();
        setAllQuestions(data.questions);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    }
    fetchQuestions();
  }, []);

  const availableSets = useMemo(() => {
    const topics = allQuestions
      .map((q) => q.topic)
      .filter((topic): topic is string => !!topic);
    return [...new Set(topics)];
  }, [allQuestions]);

  const practiceSetNames = useMemo(
    () => practiceSets.map((ps) => ps.name),
    [practiceSets]
  );

  const allSetNames = useMemo(
    () => [...availableSets, ...practiceSetNames],
    [availableSets, practiceSetNames]
  );

  useEffect(() => {
    if (availableSets.length > 0 && !selectedSet) {
      const stored = getStoredSelectedSet();
      if (stored && availableSets.includes(stored)) {
        setSelectedSet(stored);
      } else {
        setSelectedSet(availableSets[0]);
      }
    }
  }, [availableSets, selectedSet]);

  useEffect(() => {
    if (selectedSet && !practiceSetNames.includes(selectedSet)) {
      saveSelectedSet(selectedSet);
    }
  }, [selectedSet, practiceSetNames]);

  const filteredQuestions = useMemo(() => {
    if (!selectedSet) {
      return [];
    }
    const practiceSet = practiceSets.find((ps) => ps.name === selectedSet);
    if (practiceSet) {
      return practiceSet.questions;
    }
    return allQuestions.filter((q) => q.topic === selectedSet);
  }, [allQuestions, selectedSet, practiceSets]);

  const currentSetName = selectedSet || "";

  const handleCreatePracticeSet = (
    originalSetName: string,
    wrongQuestions: Question[]
  ) => {
    if (wrongQuestions.length === 0) return;
    const practiceSetName = `Practice wrong (${originalSetName})`;
    setPracticeSets((prev) => {
      const filtered = prev.filter((ps) => ps.name !== practiceSetName);
      return [
        ...filtered,
        { name: practiceSetName, questions: wrongQuestions },
      ];
    });
    setSelectedSet(practiceSetName);
  };

  const handleDeleteProgress = useCallback(() => {
    try {
      localStorage.removeItem(ANSWERED_STORAGE_KEY);
    } catch {
      // Silently fail
    }
    setProgressDeletedFlag((prev) => prev + 1);
    setSettingsDrawerOpen(false);
  }, []);

  if (loading) {
    return (
      <div className="h-svh w-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
          <p className="text-gray-500 font-medium">Loading questions...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-svh w-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-red-500 font-medium">Error: {error}</p>
          <button
            className="button-3 px-4 py-2 font-medium"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (allQuestions.length === 0) {
    return (
      <div className="h-svh w-screen flex items-center justify-center">
        <p className="text-gray-500 font-medium">No questions found.</p>
      </div>
    );
  }

  return (
    <div className="h-dvh w-screen flex flex-col" data-vaul-drawer-wrapper>
      <div className="max-w-4xl w-full mx-auto px-6 hidden md:flex items-center justify-between md:mt-10">
        <button
          className="hidden md:flex button-3 items-center gap-2.5 -translate-x-0.5 opacity-70 cursor-pointer *:cursor-pointer"
          style={{ padding: "0.6em 1.2em" }}
          onMouseDown={() => setShowingSets(!showingSets)}
        >
          <p className="font-medium">Sets</p>
          <AnimatePresence mode="popLayout">
            {showingSets ? (
              <motion.div
                key="close"
                initial={{ opacity: 0, scale: 0.65, filter: "blur(1px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.65, filter: "blur(1px)" }}
                transition={{ duration: 0.2 }}
              >
                <X size={16} />
              </motion.div>
            ) : (
              <motion.div
                key="menu"
                initial={{ opacity: 0, scale: 0.65, filter: "blur(1px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.65, filter: "blur(1px)" }}
                transition={{ duration: 0.2 }}
              >
                <Menu size={16} />
              </motion.div>
            )}
          </AnimatePresence>
        </button>
        <AnimatePresence>
          {showingSets && (
            <div className="hidden md:flex items-center gap-2 flex-wrap flex-1 ml-4">
              {allSetNames.map((set, index) => {
                const isPracticeSet = practiceSetNames.includes(set);
                const isSelected = selectedSet === set;
                return (
                  <motion.div
                    key={set}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{
                      duration: 0.15,
                      delay: index * 0.05,
                    }}
                    className="relative"
                  >
                    {isSelected && (
                      <div
                        className="absolute left-1/2 -translate-x-1/2"
                        style={{ top: "-15px" }}
                      >
                        <svg
                          width="12"
                          height="8"
                          viewBox="0 0 12 8"
                          fill="none"
                          style={{ transform: "rotate(180deg)" }}
                        >
                          <path
                            d="M6 0L12 8H0L6 0Z"
                            fill={isPracticeSet ? "#f3e8ff" : "#E6F3FD"}
                            stroke={isPracticeSet ? "#a855f7" : "#3A93DD"}
                            strokeWidth="2"
                          />
                        </svg>
                      </div>
                    )}
                    <button
                      style={{ padding: "0.6em 1.2em" }}
                      onMouseDown={() => {
                        setSelectedSet(set);
                        setShowingSets(false);
                      }}
                      className={`${
                        isPracticeSet ? "button-practice" : "button-set"
                      } font-medium`}
                    >
                      {set}
                    </button>
                  </motion.div>
                );
              })}
            </div>
          )}
        </AnimatePresence>
        <button
          className="hidden md:flex button-3 items-center justify-center opacity-70 cursor-pointer"
          style={{ padding: "0.6em" }}
          onMouseDown={() => setSettingsDrawerOpen(true)}
        >
          <Settings size={16} />
        </button>
      </div>

      <Drawer.Root
        open={settingsDrawerOpen}
        onOpenChange={setSettingsDrawerOpen}
        shouldScaleBackground
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 bg-white rounded-t-xl outline-none flex flex-col">
            <div className="mx-auto w-12 h-1.5 shrink-0 rounded-full bg-gray-300 mt-4 mb-2" />
            <Drawer.Title className="sr-only">Settings</Drawer.Title>
            <div className="px-4 pb-8 pt-2 flex flex-col gap-2">
              <button
                onMouseDown={handleDeleteProgress}
                className="button-3 w-full font-medium text-left"
                style={{ padding: "0.75em 1.2em" }}
              >
                Delete answered question progress
              </button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <Drawer.Root
        open={mobileDrawerOpen}
        onOpenChange={setMobileDrawerOpen}
        shouldScaleBackground
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 bg-white rounded-t-xl outline-none flex flex-col">
            <div className="mx-auto w-12 h-1.5 shrink-0 rounded-full bg-gray-300 mt-4 mb-2" />
            <Drawer.Title className="sr-only">Select a Set</Drawer.Title>
            <div className="px-4 pb-8 pt-2 flex flex-col gap-2">
              {allSetNames.map((set) => {
                const isPracticeSet = practiceSetNames.includes(set);
                return (
                  <button
                    key={set}
                    onMouseDown={() => {
                      setSelectedSet(set);
                      setMobileDrawerOpen(false);
                    }}
                    className={`${
                      isPracticeSet ? "button-practice" : "button-3"
                    } w-full font-medium text-left ${
                      selectedSet === set ? "ring-2 ring-gray-400" : ""
                    }`}
                    style={{ padding: "0.75em 1.2em" }}
                  >
                    {set}
                  </button>
                );
              })}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      <Questions
        questions={filteredQuestions}
        setTitle={currentSetName}
        onOpenMobileSets={() => setMobileDrawerOpen(true)}
        onCreatePracticeSet={handleCreatePracticeSet}
        isPracticeMode={practiceSetNames.includes(currentSetName)}
        progressDeletedFlag={progressDeletedFlag}
      />
    </div>
  );
}

export default App;
