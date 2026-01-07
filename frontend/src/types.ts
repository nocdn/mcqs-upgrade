export interface Question {
  id: number;
  question: string;
  options: string[];
  answer: string;
  topic?: string;
  explanation?: string | null;
  explanationSources?: string[];
}

export interface QuestionSet {
  name: string;
  questions: Question[];
}

export interface ApiResponse {
  set: string;
  questions: Question[];
}
