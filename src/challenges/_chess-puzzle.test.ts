import test from "node:test";
import assert from "node:assert/strict";

import chessPuzzleAnswerBank from "./_chess-puzzle.ts.answerbank.json" with { type: "json" };

interface ChessPuzzleRecord {
	fen: string;
	expectedSan: string;
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
