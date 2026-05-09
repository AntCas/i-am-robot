import { createFailedScore, createSuccessfulScore, getRandomInteger, wasSubmittedAfterDeadline } from "./shared.ts";
import type {
	ChallengeDefinition,
	ChallengeStartContext,
	IntegerChallengeAnswer,
	IntegerChallengeGradingKey,
	ShortTextChallengePrompt,
} from "../types.ts";

const TIMED_MATH_TIME_LIMIT_MS = 5000;

export const timedMathChallenge = {
	type: "timed_math",
	catalog: {
		responseFormat: {
			description: "Submit answer.value as the integer result encoded as a string.",
			answer: { value: "<integer-as-string>" },
		},
		example: {
			prompt: {
				kind: "short_text",
				answerFormat: "integer",
				instruction: "Solve the expression.",
				body: "What is 17 * 23 + 9?",
				inputLabel: "Answer",
			},
			answer: { value: "400" },
		},
		timeLimitMs: TIMED_MATH_TIME_LIMIT_MS,
	},
	async start(_context: ChallengeStartContext) {
		const firstFactor = getRandomInteger(120, 999);
		const secondFactor = getRandomInteger(20, 99);
		const addend = getRandomInteger(11, 89);

		return {
			promptPayload: {
				kind: "short_text",
				answerFormat: "integer",
				instruction: "Solve the expression.",
				body: `What is ${firstFactor} * ${secondFactor} + ${addend}?`,
				inputLabel: "Answer",
			},
			gradingKey: {
				answerFormat: "integer",
				expectedInteger: firstFactor * secondFactor + addend,
			},
			timeLimitMs: TIMED_MATH_TIME_LIMIT_MS,
		};
	},
	async score(context) {
		if (wasSubmittedAfterDeadline(context)) {
			return createFailedScore("deadline_exceeded");
		}

		const submittedAnswer = Number((context.answer as IntegerChallengeAnswer | undefined)?.value);
		const expectedAnswer = (context.gradingKey as IntegerChallengeGradingKey).expectedInteger;

		if (Number.isFinite(submittedAnswer) && submittedAnswer === expectedAnswer) {
			return createSuccessfulScore();
		}

		return createFailedScore("incorrect_answer");
	},
} satisfies ChallengeDefinition<"timed_math", ShortTextChallengePrompt, IntegerChallengeGradingKey, IntegerChallengeAnswer>;
