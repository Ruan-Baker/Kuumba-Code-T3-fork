import { memo } from "react";
import { CheckIcon } from "lucide-react";
import { cn } from "~/lib/utils";

interface QuestionOption {
  label: string;
  description?: string | undefined;
}

interface UserInputQuestion {
  id: string;
  header: string;
  question: string;
  options: QuestionOption[];
}

export interface PendingUserInput {
  requestId: string;
  questions: UserInputQuestion[];
}

interface PendingUserInputPanelProps {
  input: PendingUserInput;
  questionIndex: number;
  selectedOption: string | null;
  onSelectOption: (questionId: string, optionLabel: string) => void;
}

export const PendingUserInputPanel = memo(function PendingUserInputPanel({
  input,
  questionIndex,
  selectedOption,
  onSelectOption,
}: PendingUserInputPanelProps) {
  const question = input.questions[questionIndex];
  if (!question) return null;

  return (
    <div className="px-3.5 py-3">
      <div className="flex items-center gap-2">
        {input.questions.length > 1 && (
          <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground/60">
            {questionIndex + 1}/{input.questions.length}
          </span>
        )}
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50">
          {question.header}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-foreground/90">{question.question}</p>
      <div className="mt-3 space-y-1">
        {question.options.map((option, index) => {
          const isSelected = selectedOption === option.label;
          return (
            <button
              key={`${question.id}:${option.label}`}
              type="button"
              onClick={() => onSelectOption(question.id, option.label)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                isSelected
                  ? "border-info/40 bg-info/8 text-foreground"
                  : "border-transparent bg-muted/20 text-foreground/80 active:bg-muted/40",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-medium tabular-nums",
                  isSelected
                    ? "bg-info/20 text-info-foreground"
                    : "bg-muted/40 text-muted-foreground/50",
                )}
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium">{option.label}</span>
                {option.description && option.description !== option.label && (
                  <span className="ml-1.5 text-xs text-muted-foreground/50">
                    {option.description}
                  </span>
                )}
              </div>
              {isSelected && <CheckIcon className="size-3.5 shrink-0 text-info-foreground" />}
            </button>
          );
        })}
      </div>
    </div>
  );
});
