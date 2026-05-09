import { createFailedScore, createSuccessfulScore, getRandomInteger, wasSubmittedAfterDeadline } from "./shared.ts";
import type {
	ChessPuzzleChallengePrompt,
	ChallengeDefinition,
	ChallengeStartContext,
	SanChallengeAnswer,
	SanChallengeGradingKey,
} from "../types.ts";

interface ChessPuzzleRecord {
	fen: string;
	expectedSan: string;
}

// These starter puzzles intentionally use classic mate-in-one motifs that were
// heavily published in public web tutorials and forums before 2020.
const CHESS_PUZZLES: ChessPuzzleRecord[] = [
	{
		fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
		expectedSan: "Ra8#",
	},
	{
		fen: "6k1/5ppp/8/8/3Q4/8/8/7K w - - 0 1",
		expectedSan: "Qd8#",
	},
	{
		fen: "7k/6pp/5K2/6Q1/8/8/8/8 w - - 0 1",
		expectedSan: "Qxg7#",
	},
	{
		fen: "7k/6pp/5Q2/8/3B4/8/8/7K w - - 0 1",
		expectedSan: "Qxg7#",
	},
	{
		fen: "k7/1Q6/K7/8/8/8/8/8 w - - 0 1",
		expectedSan: "Qc8#",
	},
	{
		fen: "6rk/5Q1p/5KN1/8/8/8/8/8 w - - 0 1",
		expectedSan: "Qf8#",
	},
];

const CHESS_PUZZLE_TIME_LIMIT_MS = 12000;

export const chessPuzzleChallenge = {
	type: "chess_puzzle",
	catalog: {
		responseFormat: {
			description: "Submit answer.value with the best move in standard algebraic notation.",
			answer: { value: "<san-move>" },
		},
		example: {
			prompt: {
				kind: "chess_puzzle",
				answerFormat: "san",
				instruction: "Find the best next move in standard chess notation.",
				body: "White to move. Enter the strongest move in SAN.",
				inputLabel: "Best move",
				fen: "6k1/5ppp/8/8/8/8/8/1R4K1 w - - 0 1",
				orientation: "white",
				placeholder: "e.g. Rb8#",
			},
			answer: { value: "Rb8#" },
		},
		timeLimitMs: CHESS_PUZZLE_TIME_LIMIT_MS,
	},
	async start(_context: ChallengeStartContext) {
		const puzzle = CHESS_PUZZLES[getRandomInteger(0, CHESS_PUZZLES.length - 1)];

		return {
			promptPayload: {
				kind: "chess_puzzle",
				answerFormat: "san",
				instruction: "Find the best next move in standard chess notation.",
				body: "White to move. Enter the strongest move in SAN, for example Qh7# or Nf6+.",
				inputLabel: "Best move",
				fen: puzzle.fen,
				orientation: "white",
				placeholder: "e.g. Qh7#",
			},
			gradingKey: {
				answerFormat: "san",
				expectedSan: puzzle.expectedSan,
			},
			timeLimitMs: CHESS_PUZZLE_TIME_LIMIT_MS,
		};
	},
	async score(context) {
		if (wasSubmittedAfterDeadline(context)) {
			return createFailedScore("deadline_exceeded");
		}

		const submittedSan = normalizeSan((context.answer as SanChallengeAnswer | undefined)?.value ?? "");
		const expectedSan = normalizeSan((context.gradingKey as SanChallengeGradingKey).expectedSan);

		if (submittedSan && submittedSan === expectedSan) {
			return createSuccessfulScore();
		}

		return createFailedScore("incorrect_answer");
	},
} satisfies ChallengeDefinition<"chess_puzzle", ChessPuzzleChallengePrompt, SanChallengeGradingKey, SanChallengeAnswer>;

function normalizeSan(value: string): string {
	return value
		.trim()
		.replace(/\s+/g, "")
		.replace(/[!?+#]+$/g, "")
		.toLowerCase();
}
