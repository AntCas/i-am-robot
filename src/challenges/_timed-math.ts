import { createFailedScore, createSuccessfulScore, getRandomInteger, wasSubmittedAfterDeadline } from "./shared";
import type { ChallengeDefinition } from "../types";

interface TimedMathAnswer {
	value?: string;
}

interface TimedMathGradingKey {
	expected: number;
}

export const timedMathChallenge: ChallengeDefinition = {
	type: "timed_math",
	async start() {
		const firstFactor = getRandomInteger(120, 999);
		const secondFactor = getRandomInteger(20, 99);
		const addend = getRandomInteger(11, 89);

		return {
			promptPayload: {
				question: `What is ${firstFactor} * ${secondFactor} + ${addend}?`,
				answerFormat: "integer",
			},
			gradingKey: {
				expected: firstFactor * secondFactor + addend,
			},
			timeLimitMs: 5000,
		};
	},
	async score(context) {
		if (wasSubmittedAfterDeadline(context)) {
			return createFailedScore("deadline_exceeded");
		}

		const submittedAnswer = Number((context.answer as TimedMathAnswer)?.value);
		const expectedAnswer = (context.gradingKey as TimedMathGradingKey).expected;

		if (Number.isFinite(submittedAnswer) && submittedAnswer === expectedAnswer) {
			return createSuccessfulScore();
		}

		return createFailedScore("incorrect_answer");
	},
};
