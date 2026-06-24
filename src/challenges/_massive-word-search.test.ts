import test from "node:test";
import assert from "node:assert/strict";

import { massiveWordSearchChallenge } from "./_massive-word-search.ts";
import type { WordLocationsChallengeGradingKey, WordSearchWordLocation } from "../types.ts";

test("massive word search creates a 25x25 grid with every target placed at its grading location", async () => {
	const startedChallenge = await massiveWordSearchChallenge.start({
		siteKey: "site_demo_123",
		hostname: "castrio.me",
		now: new Date(),
	});

	assert.equal(startedChallenge.promptPayload.kind, "word_search");
	assert.equal(startedChallenge.promptPayload.answerFormat, "word_locations");
	assert.equal(startedChallenge.promptPayload.grid.length, 25);
	assert.equal(startedChallenge.promptPayload.words.length, 10);
	assert.equal(startedChallenge.promptPayload.grid.every((row) => row.length === 25), true);

	const gradingKey = startedChallenge.gradingKey;
	assert.equal(gradingKey.answerFormat, "word_locations");
	assert.equal(gradingKey.expectedLocations.length, startedChallenge.promptPayload.words.length);

	for (const location of gradingKey.expectedLocations) {
		assert.equal(readWordAtLocation(startedChallenge.promptPayload.grid, location), location.word);
	}
});

test("massive word search scoring accepts reversed endpoints for each word", async () => {
	const startedChallenge = await massiveWordSearchChallenge.start({
		siteKey: "site_demo_123",
		hostname: "castrio.me",
		now: new Date(),
	});
	const gradingKey = startedChallenge.gradingKey as WordLocationsChallengeGradingKey;
	const reversedLocations = gradingKey.expectedLocations.map((location) => ({
		word: location.word.toLowerCase(),
		start: location.end,
		end: location.start,
	}));

	const scoreResult = await massiveWordSearchChallenge.score({
		promptPayload: startedChallenge.promptPayload,
		gradingKey,
		answer: { locations: reversedLocations },
		submittedAt: new Date(),
		deadlineAt: new Date(Date.now() + 5_000),
	});

	assert.equal(scoreResult.score, 1);
	assert.equal(scoreResult.verdict, "robot");
});

test("massive word search scoring rejects missing locations and late submissions", async () => {
	const startedChallenge = await massiveWordSearchChallenge.start({
		siteKey: "site_demo_123",
		hostname: "castrio.me",
		now: new Date(),
	});
	const gradingKey = startedChallenge.gradingKey as WordLocationsChallengeGradingKey;

	const missingResult = await massiveWordSearchChallenge.score({
		promptPayload: startedChallenge.promptPayload,
		gradingKey,
		answer: { locations: gradingKey.expectedLocations.slice(1) },
		submittedAt: new Date(),
		deadlineAt: new Date(Date.now() + 5_000),
	});

	assert.equal(missingResult.score, 0);
	assert.equal(missingResult.verdict, "failed");
	assert.equal(missingResult.reason, "incorrect_answer");
	assert.match(missingResult.barb ?? "", /^You found 9 of 10 words\. I'm skeptical of this whole performance, .+\.$/);

	const extraResult = await massiveWordSearchChallenge.score({
		promptPayload: startedChallenge.promptPayload,
		gradingKey,
		answer: {
			locations: [
				...gradingKey.expectedLocations,
				{
					word: "NOTREQUIRED",
					start: { row: 0, column: 0 },
					end: { row: 0, column: 10 },
				},
			],
		},
		submittedAt: new Date(),
		deadlineAt: new Date(Date.now() + 5_000),
	});

	assert.equal(extraResult.score, 0);
	assert.equal(extraResult.verdict, "failed");
	assert.equal(extraResult.reason, "incorrect_answer");
	assert.match(extraResult.barb ?? "", /^You found all 10 words, then added extra nonsense for atmosphere, .+\.$/);

	const lateResult = await massiveWordSearchChallenge.score({
		promptPayload: startedChallenge.promptPayload,
		gradingKey,
		answer: { locations: gradingKey.expectedLocations },
		submittedAt: new Date("2026-01-01T00:00:01.000Z"),
		deadlineAt: new Date("2026-01-01T00:00:00.000Z"),
	});

	assert.equal(lateResult.score, 0);
	assert.equal(lateResult.verdict, "failed");
	assert.equal(lateResult.reason, "deadline_exceeded");
});

test("massive word search barb gets meaner when fewer words are found", async () => {
	const gradingKey = createWordSearchGradingKey();
	const baseContext = {
		promptPayload: {
			kind: "word_search",
			answerFormat: "word_locations",
			instruction: "Find each target word in the grid.",
			grid: [],
			words: gradingKey.expectedLocations.map((location) => location.word),
			inputLabel: "Word locations",
		},
		gradingKey,
		submittedAt: new Date("2026-06-24T12:00:00.000Z"),
		deadlineAt: new Date("2026-06-24T12:01:00.000Z"),
	} as const;

	const zeroFoundResult = await massiveWordSearchChallenge.score({
		...baseContext,
		answer: { locations: [] },
	});
	assert.match(zeroFoundResult.barb ?? "", /^You found 0 of 10 words\. Dumbfounded is doing a lot of work here, .+\.$/);

	const fiveFoundResult = await massiveWordSearchChallenge.score({
		...baseContext,
		answer: { locations: gradingKey.expectedLocations.slice(0, 5) },
	});
	assert.match(
		fiveFoundResult.barb ?? "",
		/^You found 5 of 10 words\. A toaster with stage fright might have done better, .+\.$/,
	);

	const nineFoundResult = await massiveWordSearchChallenge.score({
		...baseContext,
		answer: { locations: gradingKey.expectedLocations.slice(0, 9) },
	});
	assert.match(nineFoundResult.barb ?? "", /^You found 9 of 10 words\. I'm skeptical of this whole performance, .+\.$/);
});

function createWordSearchGradingKey(): WordLocationsChallengeGradingKey {
	return {
		answerFormat: "word_locations",
		expectedLocations: Array.from({ length: 10 }, (_, index) => {
			const word = `WORD${index}`;
			return {
				word,
				start: { row: index, column: 0 },
				end: { row: index, column: word.length - 1 },
			};
		}),
	};
}

function readWordAtLocation(grid: string[], location: WordSearchWordLocation): string {
	const rowStep = Math.sign(location.end.row - location.start.row);
	const columnStep = Math.sign(location.end.column - location.start.column);
	const length =
		Math.max(
			Math.abs(location.end.row - location.start.row),
			Math.abs(location.end.column - location.start.column),
		) + 1;

	let word = "";
	for (let index = 0; index < length; index += 1) {
		word += grid[location.start.row + rowStep * index][location.start.column + columnStep * index];
	}

	return word;
}
