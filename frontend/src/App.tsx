import { Questions } from "@/components/Questions";
import { useState, useEffect, useMemo, useCallback } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X, Settings, Loader } from "lucide-react";
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

type UploadState = "button" | "password" | "textarea";

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
  const [uploadState, setUploadState] = useState<UploadState>("button");
  const [passwordInput, setPasswordInput] = useState("");
  const [jsonInput, setJsonInput] = useState("");
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

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

  const setParentMap = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const q of allQuestions) {
      if (q.topic && q.parentSet && !map[q.topic]) {
        map[q.topic] = q.parentSet;
      }
    }
    return map;
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

  const handleSettingsDrawerChange = useCallback((open: boolean) => {
    setSettingsDrawerOpen(open);
    if (!open) {
      setUploadState("button");
      setPasswordInput("");
      setJsonInput("");
      setUploadStatus(null);
    }
  }, []);

  const handlePasswordSubmit = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && passwordInput === "elephant") {
        setUploadState("textarea");
      }
    },
    [passwordInput]
  );

  const handleUploadQuestions = useCallback(async () => {
    try {
      const parsed = JSON.parse(jsonInput);
      setUploadStatus("loading");
      const response = await fetch(`${API_URL}/api/questions/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!response.ok) {
        throw new Error("Upload failed");
      }
      await response.json();
      setUploadStatus("success");
      setJsonInput("");
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      setUploadStatus(
        `Error: ${
          err instanceof Error ? err.message : "Invalid JSON or upload failed"
        }`
      );
    }
  }, [jsonInput]);

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
                const parentSet = setParentMap[set];
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
                        className="absolute left-1/2 -translate-x-1/2 animate-bounce"
                        style={{ top: "-22px" }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill={isPracticeSet ? "#f3e8ff" : "#E6F3FD"}
                        >
                          <path
                            stroke={isPracticeSet ? "#a855f7" : "#3A93DD"}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="3.5"
                            d="M10.363 20.405L2.257 6.871A1.914 1.914 0 0 1 3.893 4h16.214a1.914 1.914 0 0 1 1.636 2.871l-8.106 13.534a1.914 1.914 0 0 1-3.274 0"
                          />
                        </svg>
                      </div>
                    )}
                    <button
                      style={{
                        padding: parentSet ? "0.4em 1.2em" : "0.6em 1.2em",
                      }}
                      onMouseDown={() => {
                        setSelectedSet(set);
                        setShowingSets(false);
                      }}
                      className={`${
                        isPracticeSet ? "button-practice" : "button-set"
                      } font-medium`}
                    >
                      {parentSet ? (
                        <span className="flex flex-col items-start leading-tight">
                          <span style={{ fontSize: "10px" }}>{parentSet}</span>
                          <span style={{ fontSize: "13px" }}>{set}</span>
                        </span>
                      ) : (
                        set
                      )}
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
        onOpenChange={handleSettingsDrawerChange}
        shouldScaleBackground
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40" />
          <Drawer.Content
            className="fixed bottom-0 left-0 right-0 bg-white rounded-t-xl outline-none flex flex-col"
            style={uploadState === "textarea" ? { height: "80vh" } : undefined}
          >
            <div className="mx-auto w-12 h-1.5 shrink-0 rounded-full bg-gray-300 mt-4 mb-2" />
            <Drawer.Title className="sr-only">Settings</Drawer.Title>
            <div
              className={`px-4 pb-8 pt-2 flex flex-col gap-2 ${
                uploadState === "textarea" ? "flex-1 overflow-hidden" : ""
              }`}
            >
              <button
                onMouseDown={handleDeleteProgress}
                className="button-3 w-full font-medium text-left"
                style={{ padding: "0.75em 1.2em", height: "48px" }}
              >
                Delete answered question progress
              </button>
              {uploadState === "button" && (
                <button
                  onMouseDown={() => setUploadState("password")}
                  className="button-3 w-full font-medium text-left cursor-pointer"
                  style={{ padding: "0.75em 1.2em", height: "48px" }}
                >
                  Upload new questions
                </button>
              )}
              {uploadState === "password" && (
                <input
                  type="password"
                  placeholder="Password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  onKeyDown={handlePasswordSubmit}
                  autoFocus
                  data-1p-ignore
                  data-bwignore
                  data-lpignore="true"
                  data-form-type="other"
                  className="button-3 w-full font-medium bg-transparent outline-none"
                  style={{ padding: "0.75em 1.2em", height: "48px" }}
                />
              )}
              {uploadState === "textarea" && (
                <div
                  className="button-3 w-full font-medium flex items-center"
                  style={{ padding: "0.75em 1.2em", height: "48px" }}
                >
                  Upload new questions
                </div>
              )}
              {uploadState === "textarea" && (
                <div className="flex flex-col gap-2 flex-1 overflow-hidden">
                  <textarea
                    placeholder="Paste question JSON here..."
                    value={jsonInput}
                    onChange={(e) => setJsonInput(e.target.value)}
                    className="flex-1 w-full p-4 border-2 border-gray-300 rounded-lg resize-none font-mono font-semibold text-sm outline-none"
                  />
                  <button
                    onMouseDown={handleUploadQuestions}
                    className="button-3 w-full font-medium mb-0.5"
                    style={{ padding: "0.75em 1.2em" }}
                  >
                    Submit
                  </button>
                  {uploadStatus && (
                    <div className="flex items-center gap-2">
                      {uploadStatus === "loading" && (
                        <Loader
                          size={16}
                          className="animate-spin text-gray-500"
                        />
                      )}
                      {uploadStatus === "success" && (
                        <p className="text-sm text-green-800 font-semibold font-rounded">
                          Submitted questions
                        </p>
                      )}
                      {uploadStatus.startsWith("Error") && (
                        <p className="text-sm text-red-500">{uploadStatus}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
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
                const parentSet = setParentMap[set];
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
                    style={{
                      padding: parentSet ? "0.5em 1.2em" : "0.75em 1.2em",
                    }}
                  >
                    {parentSet ? (
                      <span className="flex flex-col items-start leading-tight">
                        <span style={{ fontSize: "10px" }}>{parentSet}</span>
                        <span style={{ fontSize: "13px" }}>{set}</span>
                      </span>
                    ) : (
                      set
                    )}
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
