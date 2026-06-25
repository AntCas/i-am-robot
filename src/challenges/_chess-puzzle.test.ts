import test from "node:test";
import assert from "node:assert/strict";

import { chessPuzzleChallenge } from "./_chess-puzzle.ts";
import chessPuzzleAnswerBank from "./_chess-puzzle.ts.answerbank.json" with { type: "json" };

interface ChessPuzzleRecord {
	fen: string;
	expectedSan: string;
	from: string;
	to: string;
}

const CHESS_PUZZLES = chessPuzzleAnswerBank as ChessPuzzleRecord[];

test("chess puzzle answer bank only contains valid white-to-move FEN positions", () => {
	for (const puzzle of CHESS_PUZZLES) {
		const [placement = "", activeColor = ""] = puzzle.fen.trim().split(/\s+/);
		const ranks = placement.split("/");
		let whiteKings = 0;
		let blackKings = 0;

		assert.equal(activeColor, "w", `Expected white to move for ${puzzle.fen}`);
		assert.equal(ranks.length, 8, `Expected 8 ranks for ${puzzle.fen}`);
		assert.notEqual(puzzle.expectedSan.trim(), "", `Expected SAN answer for ${puzzle.fen}`);

		for (const rank of ranks) {
			let squareCount = 0;

			for (const character of rank) {
				if (/[1-8]/.test(character)) {
					squareCount += Number.parseInt(character, 10);
					continue;
				}

				assert.match(character, /^[prnbqkPRNBQK]$/, `Unexpected piece character ${character} in ${puzzle.fen}`);
				squareCount += 1;

				if (character === "K") {
					whiteKings += 1;
				}

				if (character === "k") {
					blackKings += 1;
				}
			}

			assert.equal(squareCount, 8, `Expected 8 files in rank ${rank} for ${puzzle.fen}`);
		}

		assert.equal(whiteKings, 1, `Expected one white king in ${puzzle.fen}`);
		assert.equal(blackKings, 1, `Expected one black king in ${puzzle.fen}`);
	}
});

test("every chess puzzle has a from/to that matches a legal white move to the expected square", () => {
	for (const puzzle of CHESS_PUZZLES) {
		assert.match(puzzle.from ?? "", /^[a-h][1-8]$/, `Expected a from square for ${puzzle.expectedSan}`);
		assert.match(puzzle.to ?? "", /^[a-h][1-8]$/, `Expected a to square for ${puzzle.expectedSan}`);

		const board = parseFenPlacement(puzzle.fen);
		const movingPiece = board.get(puzzle.from);
		assert.ok(movingPiece, `Expected a piece on ${puzzle.from} for ${puzzle.expectedSan}`);
		assert.ok(movingPiece === movingPiece?.toUpperCase(), `Expected a white piece to move for ${puzzle.expectedSan}`);

		// The expected SAN's destination square must equal the recorded "to" square.
		const sanDestination = puzzle.expectedSan.replace(/[+#!?]+$/g, "").slice(-2);
		assert.equal(sanDestination, puzzle.to, `SAN destination should match "to" for ${puzzle.expectedSan}`);
	}
});

function parseFenPlacement(fen: string): Map<string, string> {
	const board = new Map<string, string>();
	const ranks = fen.trim().split(/\s+/)[0]?.split("/") ?? [];
	ranks.forEach((rank, rankIndex) => {
		let fileIndex = 0;
		for (const character of rank) {
			if (/[1-8]/.test(character)) {
				fileIndex += Number.parseInt(character, 10);
				continue;
			}

			const square = String.fromCharCode("a".charCodeAt(0) + fileIndex) + String(8 - rankIndex);
			board.set(square, character);
			fileIndex += 1;
		}
	});

	return board;
}

test("chess puzzle wrong move returns a legal-looking barb", async () => {
	const scoreResult = await chessPuzzleChallenge.score({
		promptPayload: createPromptPayload(),
		gradingKey: { answerFormat: "san", expectedSan: "Rb8#", expectedFrom: "b1", expectedTo: "b8" },
		answer: { value: "Ra8" },
		submittedAt: new Date("2026-06-24T12:00:00.000Z"),
		deadlineAt: new Date("2026-06-24T12:00:05.000Z"),
	});

	assert.equal(scoreResult.score, 0);
	assert.equal(scoreResult.reason, "incorrect_answer");
	assert.match(scoreResult.barb ?? "", /^Ra8 is legal-looking theater, not the best move, .+\.$/);
	assert.deepEqual(scoreResult.barbContext, {
		type: "chess_puzzle",
		submittedMove: "Ra8",
		expectedSan: "Rb8#",
		expectedFrom: "b1",
		expectedTo: "b8",
		malformed: false,
	});
});

test("chess puzzle malformed move returns a notation barb", async () => {
	const scoreResult = await chessPuzzleChallenge.score({
		promptPayload: createPromptPayload(),
		gradingKey: { answerFormat: "san", expectedSan: "Rb8#", expectedFrom: "b1", expectedTo: "b8" },
		answer: { value: "not chess" },
		submittedAt: new Date("2026-06-24T12:00:00.000Z"),
		deadlineAt: new Date("2026-06-24T12:00:05.000Z"),
	});

	assert.equal(scoreResult.score, 0);
	assert.equal(scoreResult.reason, "incorrect_answer");
	assert.match(scoreResult.barb ?? "", /^That is not SAN\. That is keyboard fog, .+\.$/);
	assert.deepEqual(scoreResult.barbContext, {
		type: "chess_puzzle",
		submittedMove: "not chess",
		expectedSan: "Rb8#",
		expectedFrom: "b1",
		expectedTo: "b8",
		malformed: true,
	});
});

test("chess puzzle deadline returns a deadline barb", async () => {
	const scoreResult = await chessPuzzleChallenge.score({
		promptPayload: createPromptPayload(),
		gradingKey: { answerFormat: "san", expectedSan: "Rb8#", expectedFrom: "b1", expectedTo: "b8" },
		answer: { value: "" },
		submittedAt: new Date("2026-06-24T12:00:06.000Z"),
		deadlineAt: new Date("2026-06-24T12:00:05.000Z"),
	});

	assert.equal(scoreResult.score, 0);
	assert.equal(scoreResult.reason, "deadline_exceeded");
	assert.match(scoreResult.barb ?? "", /^White to move\. Eventually\. Apparently, .+\.$/);
	assert.deepEqual(scoreResult.barbContext, {
		type: "chess_puzzle",
		submittedMove: "",
		expectedSan: "Rb8#",
		expectedFrom: "b1",
		expectedTo: "b8",
		malformed: true,
	});
});

function createPromptPayload() {
	return {
		kind: "chess_puzzle" as const,
		answerFormat: "san" as const,
		instruction: "Find the best next move in standard chess notation.",
		body: "White to move.",
		inputLabel: "Best move",
		fen: "6k1/5ppp/8/8/8/8/8/1R4K1 w - - 0 1",
		orientation: "white" as const,
		placeholder: "e.g. Rb8#",
	};
}
