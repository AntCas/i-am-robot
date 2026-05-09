import { createFailedScore, createShuffledCopy, createSuccessfulScore, wasSubmittedAfterDeadline } from "./shared";
import type { ChallengeDefinition } from "../types";

interface CodeErrorAnswer {
	value?: string;
}

interface CodeErrorGradingKey {
	expectedChoice: string;
}

export const codeErrorChallenge: ChallengeDefinition = {
	type: "code_error",
	async start() {
		return {
			promptPayload: {
				description: "Find the bug in the snippet. Pick the best answer.",
				code: `function average(values) {
  let sum = 0;

  for (let i = 0; i <= values.length; i++) {
    sum += values[i];
  }

  return sum / values.length;
}`,
				choices: createShuffledCopy([
					{ value: "mutates_input", label: "It mutates the input array in place." },
					{ value: "off_by_one", label: "The loop runs one element too far and reads past the end." },
					{ value: "wrong_divisor", label: "It divides by the sum instead of the length." },
					{ value: "const_sum", label: "The sum variable should be a const." },
				]),
			},
			gradingKey: {
				expectedChoice: "off_by_one",
			},
			timeLimitMs: 7000,
		};
	},
	async score(context) {
		if (wasSubmittedAfterDeadline(context)) {
			return createFailedScore("deadline_exceeded");
		}

		const submittedChoice = String((context.answer as CodeErrorAnswer)?.value ?? "");
		const expectedChoice = (context.gradingKey as CodeErrorGradingKey).expectedChoice;

		if (submittedChoice === expectedChoice) {
			return createSuccessfulScore();
		}

		return createFailedScore("incorrect_answer");
	},
};
