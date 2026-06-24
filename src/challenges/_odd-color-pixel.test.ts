import test from "node:test";
import assert from "node:assert/strict";

import { oddColorPixelChallenge } from "./_odd-color-pixel.ts";

const START_CONTEXT = {
	siteKey: "site_demo_123",
	hostname: "castrio.me",
	now: new Date("2026-06-24T12:00:00.000Z"),
};

test("odd color pixel prompt includes a bounded clickable grid and direct coordinate format", async () => {
	const challenge = await oddColorPixelChallenge.start(START_CONTEXT);
	const { promptPayload, gradingKey } = challenge;

	assert.equal(promptPayload.kind, "pixel_grid");
	assert.equal(promptPayload.answerFormat, "grid_point");
	assert.equal(promptPayload.columns, 16);
	assert.equal(promptPayload.rows, 16);
	assert.equal(promptPayload.baseColor, "#2F7D32");
	assert.match(promptPayload.targetColor, /^#[0-9A-F]{6}$/);
	assert.equal(promptPayload.instruction, `Find the one pixel with color ${promptPayload.targetColor}.`);
	assert.notEqual(promptPayload.targetColor, promptPayload.baseColor);
	assert.notEqual(promptPayload.targetColor, "#4F7942");
	assert.ok(getMaximumChannelDifference(promptPayload.baseColor, promptPayload.targetColor) <= 4);
	assert.ok(getTotalChannelDifference(promptPayload.baseColor, promptPayload.targetColor) >= 4);
	assert.equal(promptPayload.targetColorLabel, "odd pixel");
	assert.match(promptPayload.body, /\{ "point": \{ "row": row, "column": column \} \}/);
	assert.ok(promptPayload.target.row >= 0);
	assert.ok(promptPayload.target.row < promptPayload.rows);
	assert.ok(promptPayload.target.column >= 0);
	assert.ok(promptPayload.target.column < promptPayload.columns);

	assert.deepEqual(promptPayload.target, gradingKey.expectedPoint);
	assert.equal(challenge.timeLimitMs, 20_000);
});

test("odd color pixel score requires the exact coordinate before the deadline", async () => {
	const challenge = await oddColorPixelChallenge.start(START_CONTEXT);
	const baseContext = {
		promptPayload: challenge.promptPayload,
		gradingKey: challenge.gradingKey,
		submittedAt: new Date("2026-06-24T12:00:05.000Z"),
		deadlineAt: new Date("2026-06-24T12:00:20.000Z"),
	};

	assert.deepEqual(
		await oddColorPixelChallenge.score({
			...baseContext,
			answer: { point: challenge.gradingKey.expectedPoint },
		}),
		{ score: 1, verdict: "robot" },
	);

	const wrongAnswerResult = await oddColorPixelChallenge.score({
		...baseContext,
		answer: {
			point: {
				row: challenge.gradingKey.expectedPoint.row,
				column: (challenge.gradingKey.expectedPoint.column + 1) % challenge.promptPayload.columns,
			},
		},
	});
	assert.equal(wrongAnswerResult.score, 0);
	assert.equal(wrongAnswerResult.verdict, "failed");
	assert.equal(wrongAnswerResult.reason, "incorrect_answer");
	assert.match(
		wrongAnswerResult.barb ?? "",
		new RegExp(`^That's ${challenge.promptPayload.baseColor} not ${challenge.promptPayload.targetColor}, .+\\.$`),
	);

	assert.deepEqual(
		await oddColorPixelChallenge.score({
			...baseContext,
			answer: { point: challenge.gradingKey.expectedPoint },
			submittedAt: new Date("2026-06-24T12:00:21.000Z"),
		}),
		{ score: 0, verdict: "failed", reason: "deadline_exceeded" },
	);
});

function getMaximumChannelDifference(left: string, right: string): number {
	const differences = getChannelDifferences(left, right);
	return Math.max(...differences);
}

function getTotalChannelDifference(left: string, right: string): number {
	return getChannelDifferences(left, right).reduce((total, difference) => total + difference, 0);
}

function getChannelDifferences(left: string, right: string): number[] {
	const leftChannels = parseHexChannels(left);
	const rightChannels = parseHexChannels(right);

	return leftChannels.map((channel, index) => Math.abs(channel - rightChannels[index]));
}

function parseHexChannels(color: string): number[] {
	return [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)].map((channel) => Number.parseInt(channel, 16));
}
