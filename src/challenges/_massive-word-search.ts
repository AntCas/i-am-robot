import { createFailedScore, createShuffledCopy, createSuccessfulScore, getRandomInteger, wasSubmittedAfterDeadline } from "./shared.ts";
import type {
	ChallengeDefinition,
	ChallengeStartContext,
	WordLocationsChallengeAnswer,
	WordLocationsChallengeGradingKey,
	WordSearchWordLocation,
	WordSearchChallengePrompt,
} from "../types.ts";

const MASSIVE_WORD_SEARCH_SIZE = 25;
const MASSIVE_WORD_SEARCH_TARGET_COUNT = 10;
const MASSIVE_WORD_SEARCH_TIME_LIMIT_MS = 180_000;
const WORD_SEARCH_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const WORD_SEARCH_BANK = [
	"ALGORITHM",
	"ASTEROID",
	"BYTECODE",
	"CAPTCHA",
	"CHECKSUM",
	"CIRCUIT",
	"COMPILER",
	"DATABASE",
	"FIREWALL",
	"FUNCTION",
	"KEYBOARD",
	"LATENCY",
	"NETWORK",
	"PASSWORD",
	"PROTOCOL",
	"RECURSION",
	"ROBOTICS",
	"SANDBOX",
	"SENTINEL",
	"TERMINAL",
	"VARIABLE",
	"WEBHOOK",
] as const;

const WORD_SEARCH_DIRECTIONS = [
	{ row: -1, col: -1 },
	{ row: -1, col: 0 },
	{ row: -1, col: 1 },
	{ row: 0, col: -1 },
	{ row: 0, col: 1 },
	{ row: 1, col: -1 },
	{ row: 1, col: 0 },
	{ row: 1, col: 1 },
] as const;

export const massiveWordSearchChallenge = {
	type: "massive_word_search",
	catalog: {
		responseFormat: {
			description:
				"Submit answer.locations as an array of word locations using zero-based row/column coordinates. Reversed start/end points are accepted.",
			answer: {
				locations: [
					{
						word: "<target-word>",
						start: { row: 0, column: 0 },
						end: { row: 0, column: 8 },
					},
				],
			},
		},
		example: {
			prompt: {
				kind: "word_search",
				answerFormat: "word_locations",
				instruction: "Find each target word in the grid.",
				body:
					'Coordinates are zero-based: row 0 is the first grid row, column 0 is the first character in a row. Submit { "locations": [{ "word": word, "start": { "row": row, "column": column }, "end": { "row": row, "column": column } }] }.',
				grid: [
					"ALGORITHMXX",
					"XXXXXXXXXXX",
					"XXXXXXXXXXX",
					"XXXXXXXXXXX",
					"XXXXXXXXXXX",
					"XXXXXXXXXXX",
					"XXXXXXXXXXX",
					"XXXXXXXXXXX",
					"XXXXXXXXXXX",
					"XXXXXXXXXXX",
					"XXXXXXXXXXX",
				],
				words: ["ALGORITHM"],
				inputLabel: "Word locations",
			},
			answer: {
				locations: [
					{
						word: "ALGORITHM",
						start: { row: 0, column: 0 },
						end: { row: 0, column: 8 },
					},
				],
			},
		},
		timeLimitMs: MASSIVE_WORD_SEARCH_TIME_LIMIT_MS,
	},
	async start(_context: ChallengeStartContext) {
		const words = createShuffledCopy([...WORD_SEARCH_BANK]).slice(0, MASSIVE_WORD_SEARCH_TARGET_COUNT);
		const { grid, locations } = createWordSearch(words, MASSIVE_WORD_SEARCH_SIZE);

		return {
			promptPayload: {
				kind: "word_search",
				answerFormat: "word_locations",
				instruction: "Find each target word in the grid.",
				body:
					'Return zero-based start and end coordinates for every listed word. Words may run horizontally, vertically, diagonally, or backward. Submit { "locations": [{ "word": word, "start": { "row": row, "column": column }, "end": { "row": row, "column": column } }] }.',
				grid,
				words,
				inputLabel: "Word locations",
			},
			gradingKey: {
				answerFormat: "word_locations",
				expectedLocations: locations,
			},
			timeLimitMs: MASSIVE_WORD_SEARCH_TIME_LIMIT_MS,
		};
	},
	async score(context) {
		if (wasSubmittedAfterDeadline(context)) {
			return createFailedScore("deadline_exceeded");
		}

		const expectedLocations = (context.gradingKey as WordLocationsChallengeGradingKey).expectedLocations;
		const submittedLocations = (context.answer as WordLocationsChallengeAnswer | undefined)?.locations;

		if (!Array.isArray(submittedLocations)) {
			return createFailedScore("incorrect_answer");
		}

		if (submittedLocations.length !== expectedLocations.length) {
			return createFailedScore("incorrect_answer");
		}

		for (const expectedLocation of expectedLocations) {
			const submittedLocation = submittedLocations.find(
				(location) => normalizeWord(location?.word) === normalizeWord(expectedLocation.word),
			);

			if (!submittedLocation || !locationsMatch(expectedLocation, submittedLocation)) {
				return createFailedScore("incorrect_answer");
			}
		}

		return createSuccessfulScore();
	},
} satisfies ChallengeDefinition<
	"massive_word_search",
	WordSearchChallengePrompt,
	WordLocationsChallengeGradingKey,
	WordLocationsChallengeAnswer
>;

function createWordSearch(words: readonly string[], size: number): { grid: string[]; locations: WordSearchWordLocation[] } {
	const grid: string[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => ""));
	const locations: WordSearchWordLocation[] = [];

	for (const word of words) {
		const placedLocation = placeWord(grid, word);
		locations.push(placedLocation);
	}

	for (let row = 0; row < size; row += 1) {
		for (let col = 0; col < size; col += 1) {
			if (!grid[row][col]) {
				grid[row][col] = WORD_SEARCH_ALPHABET[getRandomInteger(0, WORD_SEARCH_ALPHABET.length - 1)];
			}
		}
	}

	return {
		grid: grid.map((row) => row.join("")),
		locations,
	};
}

function placeWord(grid: string[][], word: string): WordSearchWordLocation {
	const normalizedWord = normalizeWord(word);
	const size = grid.length;

	for (let attempt = 0; attempt < 2_000; attempt += 1) {
		const direction = WORD_SEARCH_DIRECTIONS[getRandomInteger(0, WORD_SEARCH_DIRECTIONS.length - 1)];
		const row = getRandomInteger(0, size - 1);
		const col = getRandomInteger(0, size - 1);
		const endRow = row + direction.row * (normalizedWord.length - 1);
		const endCol = col + direction.col * (normalizedWord.length - 1);

		if (!isInsideGrid(endRow, endCol, size)) {
			continue;
		}

		if (!canPlaceWord(grid, normalizedWord, row, col, direction)) {
			continue;
		}

		for (let index = 0; index < normalizedWord.length; index += 1) {
			grid[row + direction.row * index][col + direction.col * index] = normalizedWord[index];
		}

		return {
			word: normalizedWord,
			start: { row, column: col },
			end: { row: endRow, column: endCol },
		};
	}

	throw new Error(`Unable to place word in massive word search: ${normalizedWord}`);
}

function canPlaceWord(
	grid: string[][],
	word: string,
	row: number,
	col: number,
	direction: (typeof WORD_SEARCH_DIRECTIONS)[number],
): boolean {
	for (let index = 0; index < word.length; index += 1) {
		const existingLetter = grid[row + direction.row * index][col + direction.col * index];

		if (existingLetter && existingLetter !== word[index]) {
			return false;
		}
	}

	return true;
}

function isInsideGrid(row: number, col: number, size: number): boolean {
	return row >= 0 && row < size && col >= 0 && col < size;
}

function locationsMatch(expectedLocation: WordSearchWordLocation, submittedLocation: WordSearchWordLocation): boolean {
	const expectedStart = expectedLocation.start;
	const expectedEnd = expectedLocation.end;
	const submittedStart = submittedLocation.start;
	const submittedEnd = submittedLocation.end;

	return (
		(pointsMatch(expectedStart, submittedStart) && pointsMatch(expectedEnd, submittedEnd)) ||
		(pointsMatch(expectedStart, submittedEnd) && pointsMatch(expectedEnd, submittedStart))
	);
}

function pointsMatch(left: WordSearchWordLocation["start"], right: WordSearchWordLocation["start"]): boolean {
	return left.row === right?.row && left.column === right?.column;
}

function normalizeWord(word: unknown): string {
	return String(word ?? "")
		.trim()
		.toUpperCase();
}
