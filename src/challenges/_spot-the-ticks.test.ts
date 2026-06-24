import test from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";

import { spotTheTicksChallenge } from "./_spot-the-ticks.ts";
import type { PointsChallengeAnswer, PointsChallengeGradingKey, PointClickChallengePrompt } from "../types.ts";

function createScoreContext(args: {
	gradingKey: PointsChallengeGradingKey;
	answer?: PointsChallengeAnswer;
	submittedAt?: Date;
	deadlineAt?: Date;
}) {
	return {
		promptPayload: {} as PointClickChallengePrompt,
		gradingKey: args.gradingKey,
		answer: args.answer,
		submittedAt: args.submittedAt ?? new Date("2026-01-01T00:00:01.000Z"),
		deadlineAt: args.deadlineAt ?? new Date("2026-01-01T00:00:02.000Z"),
	};
}

test("spot the ticks start payload includes a muffin image and renderable tick sprites", async () => {
	const result = await spotTheTicksChallenge.start({
		siteKey: "site_demo_123",
		hostname: "castrio.me",
		now: new Date("2026-01-01T00:00:00.000Z"),
	});

	assert.equal(result.promptPayload.kind, "point_click");
	assert.equal(result.promptPayload.answerFormat, "points");
	assert.equal(result.promptPayload.width, 640);
	assert.equal(result.promptPayload.height, 420);
	assert.equal(result.promptPayload.targetLabel, "tick");
	assert.equal(result.promptPayload.backgroundImageUrl, "/challenge-assets/lemon-poppy-seed-muffin.webp");
	assert.equal(result.gradingKey.answerFormat, "points");
	assert.equal(result.gradingKey.hitRadius, 24);

	const ticks = result.promptPayload.items.filter((item) => item.kind === "tick");
	const seeds = result.promptPayload.items.filter((item) => item.kind === "seed");

	assert.ok(ticks.length >= 4);
	assert.ok(ticks.length <= 6);
	assert.equal(seeds.length, 0);
	assert.equal(result.gradingKey.expectedPoints.length, ticks.length);

	for (const item of result.promptPayload.items) {
		assert.match(item.id, /^tick_\d+$/);
		assert.ok(item.x >= 0 && item.x < result.promptPayload.width);
		assert.ok(item.y >= 0 && item.y < result.promptPayload.height);
		assert.ok(item.radius > 0);
		assert.equal(item.radius, 5);
		assert.equal(item.imageUrl, "/challenge-assets/tick.svg");
	}

	for (const target of result.gradingKey.expectedPoints) {
		assert.ok(ticks.some((tick) => tick.x === target.x && tick.y === target.y));
	}
});

test("spot the ticks image assets stay within requested size limits", () => {
	const muffinSize = statSync("site/challenge-assets/lemon-poppy-seed-muffin.webp").size;
	const tickSize = statSync("site/challenge-assets/tick.svg").size;

	assert.ok(muffinSize < 100_000);
	assert.ok(tickSize < 1_000);
});

test("spot the ticks accepts every tick target within hit tolerance", async () => {
	const gradingKey = {
		answerFormat: "points",
		expectedPoints: [
			{ x: 100, y: 100 },
			{ x: 240, y: 190 },
		],
		hitRadius: 20,
	} satisfies PointsChallengeGradingKey;

	const result = await spotTheTicksChallenge.score(
		createScoreContext({
			gradingKey,
			answer: {
				points: [
					{ x: 112, y: 100 },
					{ x: 240, y: 208 },
				],
			},
		}),
	);

	assert.deepEqual(result, { score: 1, verdict: "robot" });
});

test("spot the ticks rejects missed targets, duplicate target clicks, extra misses, and late submissions", async () => {
	const gradingKey = {
		answerFormat: "points",
		expectedPoints: [
			{ x: 100, y: 100 },
			{ x: 240, y: 190 },
		],
		hitRadius: 20,
	} satisfies PointsChallengeGradingKey;

	const missedTarget = await spotTheTicksChallenge.score(
		createScoreContext({
			gradingKey,
			answer: { points: [{ x: 100, y: 100 }] },
		}),
	);
	assert.deepEqual(missedTarget, { score: 0, verdict: "failed", reason: "incorrect_answer" });

	const duplicateTarget = await spotTheTicksChallenge.score(
		createScoreContext({
			gradingKey,
			answer: {
				points: [
					{ x: 100, y: 100 },
					{ x: 105, y: 100 },
				],
			},
		}),
	);
	assert.deepEqual(duplicateTarget, { score: 0, verdict: "failed", reason: "incorrect_answer" });

	const extraMiss = await spotTheTicksChallenge.score(
		createScoreContext({
			gradingKey,
			answer: {
				points: [
					{ x: 100, y: 100 },
					{ x: 240, y: 190 },
					{ x: 500, y: 300 },
				],
			},
		}),
	);
	assert.deepEqual(extraMiss, { score: 0, verdict: "failed", reason: "incorrect_answer" });

	const lateSubmission = await spotTheTicksChallenge.score(
		createScoreContext({
			gradingKey,
			answer: {
				points: [
					{ x: 100, y: 100 },
					{ x: 240, y: 190 },
				],
			},
			submittedAt: new Date("2026-01-01T00:00:03.000Z"),
			deadlineAt: new Date("2026-01-01T00:00:02.000Z"),
		}),
	);
	assert.deepEqual(lateSubmission, { score: 0, verdict: "failed", reason: "deadline_exceeded" });
});
