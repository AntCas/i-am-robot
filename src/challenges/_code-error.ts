import {
	createFailedScore,
	createShuffledCopy,
	createSuccessfulScore,
	getRandomInteger,
	wasSubmittedAfterDeadline,
} from "./shared";
import type { ChallengeDefinition, ChoiceChallengeAnswer, ChoiceChallengeGradingKey } from "../types";

const CODE_ERROR_CHOICES = [
	{ value: "mutates_input", label: "It mutates the input array in place." },
	{ value: "off_by_one", label: "The loop runs one element too far and reads past the end." },
	{ value: "wrong_divisor", label: "It divides by the sum instead of the length." },
	{ value: "const_sum", label: "The sum variable is declared as const but then reassigned." },
] as const;

type CodeErrorChoiceValue = (typeof CODE_ERROR_CHOICES)[number]["value"];

interface CodeErrorPrompt {
	code: string;
	expectedChoice: CodeErrorChoiceValue;
}

const CODE_ERROR_PROMPTS: CodeErrorPrompt[] = [
	{
		code: `function median(values) {
  values.sort((left, right) => left - right);

  const middle = Math.floor(values.length / 2);

  return values[middle];
}`,
		expectedChoice: "mutates_input",
	},
	{
		code: `function average(values) {
  let sum = 0;

  for (let i = 0; i <= values.length; i++) {
    sum += values[i];
  }

  return sum / values.length;
}`,
		expectedChoice: "off_by_one",
	},
	{
		code: `function average(values) {
  let sum = 0;

  for (const value of values) {
    sum += value;
  }

  return sum / sum;
}`,
		expectedChoice: "wrong_divisor",
	},
	{
		code: `function average(values) {
  const sum = 0;

  for (const value of values) {
    sum += value;
  }

  return sum / values.length;
}`,
		expectedChoice: "const_sum",
	},
];

export const codeErrorChallenge: ChallengeDefinition = {
	type: "code_error",
	async start() {
		const prompt = CODE_ERROR_PROMPTS[getRandomInteger(0, CODE_ERROR_PROMPTS.length - 1)];

		return {
			promptPayload: {
				kind: "multiple_choice",
				answerFormat: "choice_id",
				instruction: "Find the bug in the snippet. Pick the best answer.",
				code: prompt.code,
				layout: "list",
				choices: createShuffledCopy([...CODE_ERROR_CHOICES]).map((choice) => ({
					id: choice.value,
					label: choice.label,
				})),
			},
			gradingKey: {
				answerFormat: "choice_id",
				expectedChoiceId: prompt.expectedChoice,
			},
			timeLimitMs: 7000,
		};
	},
	async score(context) {
		if (wasSubmittedAfterDeadline(context)) {
			return createFailedScore("deadline_exceeded");
		}

		const submittedChoice = String((context.answer as ChoiceChallengeAnswer | undefined)?.choiceId ?? "");
		const expectedChoice = (context.gradingKey as ChoiceChallengeGradingKey).expectedChoiceId;

		if (submittedChoice === expectedChoice) {
			return createSuccessfulScore();
		}

		return createFailedScore("incorrect_answer");
	},
};
