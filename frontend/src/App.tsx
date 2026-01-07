import { Questions } from "@/components/Questions";
import { useState, useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import type { Question, ApiResponse } from "./types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

function App() {
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSet, setSelectedSet] = useState<string | null>(null);
  const [showingSets, setShowingSets] = useState(false);

  // Fetch questions on mount
  useEffect(() => {
    async function fetchQuestions() {
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

  // Extract unique sets from questions
  const availableSets = useMemo(() => {
    const topics = allQuestions
      .map((q) => q.topic)
      .filter((topic): topic is string => !!topic);
    return [...new Set(topics)];
  }, [allQuestions]);

  // Auto-select first set when questions load
  useEffect(() => {
    if (availableSets.length > 0 && !selectedSet) {
      setSelectedSet(availableSets[0]);
    }
  }, [availableSets, selectedSet]);

  // Filter questions based on selected set
  const filteredQuestions = useMemo(() => {
    if (!selectedSet) {
      return [];
    }
    return allQuestions.filter((q) => q.topic === selectedSet);
  }, [allQuestions, selectedSet]);

  const currentSetName = selectedSet || "";

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
          <p className="text-gray-500 font-medium">Loading questions...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
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
      <div className="h-screen w-screen flex items-center justify-center">
        <p className="text-gray-500 font-medium">No questions found.</p>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col" data-vaul-drawer-wrapper>
      <div className="max-w-3xl w-full mx-auto px-6 flex items-center gap-4 mt-10">
        <button
          className="button-3 flex items-center gap-2.5 -translate-x-0.5 opacity-70 cursor-pointer *:cursor-pointer"
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
            <div className="flex items-center gap-2 flex-wrap">
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
      <Questions questions={filteredQuestions} setTitle={currentSetName} />
    </div>
  );
}

export default App;
