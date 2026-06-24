import test from "node:test";
import assert from "node:assert/strict";

import { codeErrorChallenge } from "./_code-error.ts";
import type { ChoiceChallengeGradingKey, MultipleChoiceChallengePrompt } from "../types.ts";

test("code error returns challenge barbs for wrong, empty, and late answers", async () => {
	const baseContext = {
		promptPayload: createPrompt(),
		gradingKey: { answerFormat: "choice_id", expectedChoiceId: "off_by_one" } satisfies ChoiceChallengeGradingKey,
		submittedAt: new Date("2026-06-24T12:00:00.000Z"),
		deadlineAt: new Date("2026-06-24T12:01:00.000Z"),
	};

	const wrongResult = await codeErrorChallenge.score({
		...baseContext,
		answer: { choiceId: "mutates_input" },
	});
	assert.equal(wrongResult.score, 0);
	assert.equal(wrongResult.verdict, "failed");
	assert.equal(wrongResult.reason, "incorrect_answer");
	assert.match(wrongResult.barb ?? "", /^The bug survived your review\. It has requested seniority, .+\.$/);
	assert.deepEqual(wrongResult.barbContext, {
		challengeType: "code_error",
		expectedChoiceId: "off_by_one",
	});

	const emptyResult = await codeErrorChallenge.score({
		...baseContext,
		answer: { choiceId: "" },
	});
	assert.equal(emptyResult.score, 0);
	assert.equal(emptyResult.reason, "incorrect_answer");
	assert.match(emptyResult.barb ?? "", /^No diagnosis submitted\. Very collaborative of you, .+\.$/);
	assert.deepEqual(emptyResult.barbContext, wrongResult.barbContext);

	const missingAnswerResult = await codeErrorChallenge.score({
		...baseContext,
		answer: undefined,
	});
	assert.equal(missingAnswerResult.score, 0);
	assert.equal(missingAnswerResult.reason, "incorrect_answer");
	assert.match(missingAnswerResult.barb ?? "", /^No diagnosis submitted\. Very collaborative of you, .+\.$/);
	assert.deepEqual(missingAnswerResult.barbContext, wrongResult.barbContext);

	const lateResult = await codeErrorChallenge.score({
		...baseContext,
		answer: { choiceId: "off_by_one" },
		submittedAt: new Date("2026-06-24T12:01:00.001Z"),
	});
	assert.equal(lateResult.score, 0);
	assert.equal(lateResult.verdict, "failed");
	assert.equal(lateResult.reason, "deadline_exceeded");
	assert.match(lateResult.barb ?? "", /^The stack trace aged into archaeology, .+\.$/);
	assert.deepEqual(lateResult.barbContext, wrongResult.barbContext);
});

function createPrompt(): MultipleChoiceChallengePrompt {
	return {
		kind: "multiple_choice",
		answerFormat: "choice_id",
		instruction: "Find the bug in the snippet. Pick the best answer.",
		code: "for (let i = 0; i <= values.length; i++) {}",
		layout: "list",
		choices: [
			{ id: "mutates_input", label: "It mutates the input array in place." },
			{ id: "off_by_one", label: "The loop runs one element too far and reads past the end." },
		],
	};
}
