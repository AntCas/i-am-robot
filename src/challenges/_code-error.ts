import {
	createFailedScore,
	createShuffledCopy,
	createSuccessfulScore,
	getRandomInteger,
	wasSubmittedAfterDeadline,
} from "./shared.ts";
import type {
	ChallengeDefinition,
	ChallengeStartContext,
	ChoiceChallengeAnswer,
	ChoiceChallengeGradingKey,
	MultipleChoiceChallengePrompt,
} from "../types.ts";
import codeErrorAnswerBank from "./_code-error.ts.answerbank.json" with { type: "json" };

interface CodeErrorAnswerBank {
	choices: CodeErrorChoice[];
	prompts: CodeErrorPrompt[];
}

interface CodeErrorChoice {
	value: string;
	label: string;
}

const CODE_ERROR_ANSWER_BANK = codeErrorAnswerBank as CodeErrorAnswerBank;
const CODE_ERROR_CHOICES = CODE_ERROR_ANSWER_BANK.choices;

interface CodeErrorPrompt {
	code: string;
	expectedChoice: string;
}

const CODE_ERROR_PROMPTS = CODE_ERROR_ANSWER_BANK.prompts;

const CODE_ERROR_TIME_LIMIT_MS = 7000;

export const codeErrorChallenge = {
	type: "code_error",
	catalog: {
		responseFormat: {
			description: "Submit answer.choiceId with the id of the selected bug explanation.",
			answer: { choiceId: "<choice-id>" },
		},
		example: {
			prompt: {
				kind: "multiple_choice",
				answerFormat: "choice_id",
				instruction: "Find the bug in the snippet. Pick the best answer.",
				code: `function first(items) {
  return items[1];
}`,
				layout: "list",
				choices: [
					{ id: "wrong_index", label: "It returns the second item instead of the first." },
					{ id: "mutates_items", label: "It mutates the input array." },
					{ id: "missing_return", label: "It does not return a value." },
					{ id: "syntax_error", label: "It has invalid JavaScript syntax." },
				],
			},
			answer: { choiceId: "wrong_index" },
		},
		timeLimitMs: CODE_ERROR_TIME_LIMIT_MS,
	},
	async start(_context: ChallengeStartContext) {
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
			timeLimitMs: CODE_ERROR_TIME_LIMIT_MS,
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
} satisfies ChallengeDefinition<"code_error", MultipleChoiceChallengePrompt, ChoiceChallengeGradingKey, ChoiceChallengeAnswer>;
