import { createBarb, createFailedScore, createSuccessfulScore, getRandomInteger, wasSubmittedAfterDeadline } from "./shared.ts";
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
		const submittedValue = (context.answer as SanChallengeAnswer | undefined)?.value ?? "";
		const submittedMove = submittedValue.trim();
		const expectedMove = (context.gradingKey as SanChallengeGradingKey).expectedSan;

		if (wasSubmittedAfterDeadline(context)) {
			return {
				...createFailedScore("deadline_exceeded"),
				barb: createBarb("White to move. Eventually. Apparently"),
				barbContext: createChessBarbContext(submittedMove, expectedMove, !isPlausibleSan(submittedMove)),
			};
		}

		const submittedSan = normalizeSan(submittedMove);
		const expectedSan = normalizeSan(expectedMove);

		if (submittedSan && submittedSan === expectedSan) {
			return createSuccessfulScore();
		}

		if (!isPlausibleSan(submittedMove)) {
			return {
				...createFailedScore("incorrect_answer"),
				barb: createBarb("That is not SAN. That is keyboard fog"),
				barbContext: createChessBarbContext(submittedMove, expectedMove, true),
			};
		}

		return {
			...createFailedScore("incorrect_answer"),
			barb: createBarb(`${submittedMove} is legal-looking theater, not the best move`),
			barbContext: createChessBarbContext(submittedMove, expectedMove, false),
		};
	},
} satisfies ChallengeDefinition<"chess_puzzle", ChessPuzzleChallengePrompt, SanChallengeGradingKey, SanChallengeAnswer>;

function normalizeSan(value: string): string {
	return value
		.trim()
		.replace(/\s+/g, "")
		.replace(/[!?+#]+$/g, "")
		.toLowerCase();
}

function isPlausibleSan(value: string): boolean {
	const move = value.trim();
	if (!move) {
		return false;
	}

	if (/^(O-O|0-0)(-O|-0)?[+#]?[!?]*$/.test(move)) {
		return true;
	}

	return /^(?:[KQRBN])?(?:[a-h]|[1-8])?x?[a-h][1-8](?:=[QRBN])?[+#]?[!?]*$/.test(move);
}

function createChessBarbContext(submittedMove: string, expectedMove: string, malformed: boolean): Record<string, unknown> {
	return {
		type: "chess_puzzle",
		submittedMove,
		expectedSan: expectedMove,
		malformed,
	};
}
