import test from "node:test";
import assert from "node:assert/strict";

import { timedMathChallenge } from "./_timed-math.ts";
import type { IntegerChallengeGradingKey, ShortTextChallengePrompt } from "../types.ts";

test("timed math prompt exposes expression parts without exposing the answer", async () => {
	const startedChallenge = await timedMathChallenge.start({
		siteKey: "site_demo_123",
		hostname: "castrio.me",
		now: new Date(),
	});

	assert.equal(startedChallenge.promptPayload.kind, "short_text");
	assert.equal(startedChallenge.promptPayload.answerFormat, "integer");
	assert.deepEqual(startedChallenge.promptPayload.mathExpressionParts?.filter((part) => ["*", "+"].includes(part)), ["*", "+"]);
	assert.equal(startedChallenge.promptPayload.mathExpressionParts?.includes(String(startedChallenge.gradingKey.expectedInteger)), false);
});

test("timed math returns challenge barbs for wrong and late answers", async () => {
	const baseContext = {
		promptPayload: createPrompt(),
		gradingKey: { answerFormat: "integer", expectedInteger: 400 } satisfies IntegerChallengeGradingKey,
		submittedAt: new Date("2026-06-24T12:00:00.000Z"),
		deadlineAt: new Date("2026-06-24T12:01:00.000Z"),
	};

	const closeResult = await timedMathChallenge.score({
		...baseContext,
		answer: { value: "397" },
	});
	assert.equal(closeResult.score, 0);
	assert.equal(closeResult.reason, "incorrect_answer");
	assert.match(closeResult.barb ?? "", /^Off by 3\. Tragic, but at least numerically adjacent, .+\.$/);

	const wrongResult = await timedMathChallenge.score({
		...baseContext,
		answer: { value: "banana" },
	});
	assert.equal(wrongResult.score, 0);
	assert.equal(wrongResult.reason, "incorrect_answer");
	assert.match(wrongResult.barb ?? "", /^Arithmetic has declined since humans got calculators, .+\.$/);

	const lateResult = await timedMathChallenge.score({
		...baseContext,
		answer: { value: "400" },
		submittedAt: new Date("2026-06-24T12:01:00.001Z"),
	});
	assert.equal(lateResult.score, 0);
	assert.equal(lateResult.reason, "deadline_exceeded");
	assert.match(lateResult.barb ?? "", /^The numbers waited patiently\. You did not, .+\.$/);
});

function createPrompt(): ShortTextChallengePrompt {
	return {
		kind: "short_text",
		answerFormat: "integer",
		instruction: "Solve the expression.",
		body: "What is 17 * 23 + 9?",
		inputLabel: "Answer",
		mathExpressionParts: ["17", "*", "23", "+", "9"],
	};
}
