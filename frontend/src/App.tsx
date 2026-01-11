import { Questions } from "@/components/Questions";
import { useState, useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import { Drawer } from "vaul";
import type { Question, ApiResponse } from "./types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";
const IS_DEV = import.meta.env.DEV;

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
  {
    id: 900002,
    question:
      "Which research method involves collecting data at a single point in time?",
    options: [
      "Longitudinal study",
      "Cross-sectional study",
      "Case study",
      "Experimental study",
    ],
    answer: "Cross-sectional study",
    topic: "SPID",
  },
  {
    id: 900003,
    question: "What does 'operationalization' mean in research?",
    options: [
      "Running statistical operations",
      "Defining abstract concepts in measurable terms",
      "Operating research equipment",
      "Organizing research teams",
    ],
    answer: "Defining abstract concepts in measurable terms",
    topic: "SPID",
  },
  {
    id: 900004,
    question:
      "Which type of validity concerns whether results can be generalized?",
    options: [
      "Internal validity",
      "External validity",
      "Construct validity",
      "Face validity",
    ],
    answer: "External validity",
    topic: "SPID",
  },
  {
    id: 900005,
    question: "What is social loafing?",
    options: [
      "Relaxing in social settings",
      "Reduced effort when working in groups",
      "Learning from social media",
      "Taking breaks during work",
    ],
    answer: "Reduced effort when working in groups",
    topic: "Social",
  },
  {
    id: 900006,
    question:
      "The bystander effect suggests that people are less likely to help when:",
    options: [
      "They are alone",
      "Others are present",
      "The victim is known",
      "It is daytime",
    ],
    answer: "Others are present",
    topic: "Social",
  },
  {
    id: 900007,
    question: "Cognitive dissonance occurs when:",
    options: [
      "People agree with each other",
      "Beliefs and actions conflict",
      "Memory fails",
      "Groups make decisions",
    ],
    answer: "Beliefs and actions conflict",
    topic: "Social",
  },
  {
    id: 900008,
    question: "Which concept describes changing behavior to match group norms?",
    options: ["Obedience", "Conformity", "Compliance", "Persuasion"],
    answer: "Conformity",
    topic: "Social",
  },
  {
    id: 900009,
    question: "The fundamental attribution error involves:",
    options: [
      "Overestimating situational factors",
      "Underestimating dispositional factors",
      "Overestimating dispositional factors for others' behavior",
      "Accurate attribution of causes",
    ],
    answer: "Overestimating dispositional factors for others' behavior",
    topic: "Social",
  },
  {
    id: 900010,
    question: "In-group bias refers to:",
    options: [
      "Disliking all groups equally",
      "Favoring members of one's own group",
      "Being unbiased toward groups",
      "Joining multiple groups",
    ],
    answer: "Favoring members of one's own group",
    topic: "Social",
  },
];

function isMobileDevice(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

function App() {
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSet, setSelectedSet] = useState<string | null>(null);
  const [showingSets, setShowingSets] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

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

  useEffect(() => {
    if (availableSets.length > 0 && !selectedSet) {
      setSelectedSet(availableSets[0]);
    }
  }, [availableSets, selectedSet]);

  const filteredQuestions = useMemo(() => {
    if (!selectedSet) {
      return [];
    }
    return allQuestions.filter((q) => q.topic === selectedSet);
  }, [allQuestions, selectedSet]);

  const currentSetName = selectedSet || "";

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
      <div className="max-w-3xl w-full mx-auto px-6 hidden md:flex items-center gap-4 md:mt-10">
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
            <div className="hidden md:flex items-center gap-2 flex-wrap">
              {availableSets.map((set, index) => (
                <motion.button
                  key={set}
                  initial={{ opacity: 0, scale: 0.95 }}
                  style={{ padding: "0.6em 1.2em" }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{
                    duration: 0.15,
                    delay: index * 0.05,
                  }}
                  onMouseDown={() => {
                    setSelectedSet(set);
                    setShowingSets(false);
                  }}
                  className={`button-set font-medium ${
                    selectedSet === set ? "ring-2 ring-gray-400" : ""
                  }`}
                >
                  {set}
                </motion.button>
              ))}
            </div>
          )}
        </AnimatePresence>
      </div>

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
              {availableSets.map((set) => (
                <button
                  key={set}
                  onMouseDown={() => {
                    setSelectedSet(set);
                    setMobileDrawerOpen(false);
                  }}
                  className={`button-3 w-full font-medium text-left ${
                    selectedSet === set ? "ring-2 ring-gray-400" : ""
                  }`}
                  style={{ padding: "0.75em 1.2em" }}
                >
                  {set}
                </button>
              ))}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      <Questions
        questions={filteredQuestions}
        setTitle={currentSetName}
        onOpenMobileSets={() => setMobileDrawerOpen(true)}
      />
    </div>
  );
}

export default App;
