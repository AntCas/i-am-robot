import { createFailedScore, createSuccessfulScore, getRandomInteger, wasSubmittedAfterDeadline } from "./shared.ts";
import type {
	ChessPuzzleChallengePrompt,
	ChallengeDefinition,
	ChallengeStartContext,
	SanChallengeAnswer,
	SanChallengeGradingKey,
} from "../types.ts";
import chessPuzzleAnswerBank from "./_chess-puzzle.ts.answerbank.json" with { type: "json" };

interface ChessPuzzleRecord {
	fen: string;
	expectedSan: string;
}

const CHESS_PUZZLES = chessPuzzleAnswerBank as ChessPuzzleRecord[];

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
