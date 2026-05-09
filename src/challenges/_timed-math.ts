import { createFailedScore, createSuccessfulScore, getRandomInteger, wasSubmittedAfterDeadline } from "./shared.ts";
import type { ChallengeDefinition, IntegerChallengeAnswer, IntegerChallengeGradingKey } from "../types.ts";

export const timedMathChallenge: ChallengeDefinition = {
	type: "timed_math",
	async start() {
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
			timeLimitMs: 5000,
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
};
