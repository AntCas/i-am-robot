import { createBarb, createFailedScore, createSuccessfulScore, getRandomInteger, wasSubmittedAfterDeadline } from "./shared.ts";
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
				mathExpressionParts: ["17", "*", "23", "+", "9"],
			},
			answer: { value: "400" },
		},
		timeLimitMs: TIMED_MATH_TIME_LIMIT_MS,
	},
	async start(_context: ChallengeStartContext) {
		const firstFactor = getRandomInteger(120, 999);
		const secondFactor = getRandomInteger(20, 99);
		const addend = getRandomInteger(11, 89);
		const mathExpressionParts = [String(firstFactor), "*", String(secondFactor), "+", String(addend)];

		return {
			promptPayload: {
				kind: "short_text",
				answerFormat: "integer",
				instruction: "Solve the expression.",
				body: `What is ${firstFactor} * ${secondFactor} + ${addend}?`,
				inputLabel: "Answer",
				mathExpressionParts,
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
			return {
				...createFailedScore("deadline_exceeded"),
				barb: createBarb("The numbers waited patiently. You did not"),
			};
		}

		const submittedAnswer = Number((context.answer as IntegerChallengeAnswer | undefined)?.value);
		const expectedAnswer = (context.gradingKey as IntegerChallengeGradingKey).expectedInteger;

		if (Number.isFinite(submittedAnswer) && submittedAnswer === expectedAnswer) {
			return createSuccessfulScore();
		}

		return {
			...createFailedScore("incorrect_answer"),
			barb: createTimedMathBarb(submittedAnswer, expectedAnswer),
		};
	},
} satisfies ChallengeDefinition<"timed_math", ShortTextChallengePrompt, IntegerChallengeGradingKey, IntegerChallengeAnswer>;

function createTimedMathBarb(submittedAnswer: number, expectedAnswer: number): string {
	if (Number.isFinite(submittedAnswer)) {
		const delta = Math.abs(submittedAnswer - expectedAnswer);

		if (delta > 0 && delta <= 10) {
			return createBarb(`Off by ${delta}. Tragic, but at least numerically adjacent`);
		}
	}

	return createBarb("Arithmetic has declined since humans got calculators");
}
