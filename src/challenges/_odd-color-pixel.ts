import { createBarb, createFailedScore, createSuccessfulScore, getRandomInteger, wasSubmittedAfterDeadline } from "./shared.ts";
import type {
	ChallengeDefinition,
	ChallengeStartContext,
	GridPointChallengeAnswer,
	GridPointChallengeGradingKey,
	PixelGridChallengePrompt,
} from "../types.ts";

const ODD_COLOR_PIXEL_COLUMNS = 16;
const ODD_COLOR_PIXEL_ROWS = 16;
const ODD_COLOR_PIXEL_BASE_COLOR = "#2F7D32";
const ODD_COLOR_PIXEL_TIME_LIMIT_MS = 20_000;
const ODD_COLOR_PIXEL_COLOR_OFFSETS = [
	{ red: 0, green: 4, blue: 0 },
	{ red: 0, green: -4, blue: 0 },
	{ red: 3, green: 0, blue: 2 },
	{ red: -3, green: 0, blue: -2 },
	{ red: 2, green: 3, blue: -2 },
	{ red: -2, green: -3, blue: 2 },
] as const;

export const oddColorPixelChallenge = {
	type: "odd_color_pixel",
	catalog: {
		responseFormat: {
			description:
				"Submit answer.point.row and answer.point.column as zero-based integer coordinates, measured from the top-left pixel.",
			answer: { point: { row: 0, column: 0 } },
		},
		example: {
			prompt: {
				kind: "pixel_grid",
				answerFormat: "grid_point",
				instruction: "Find the one pixel with color #4F7942.",
				body: "The grid is 4 rows by 4 columns. Coordinates are zero-based from the top-left.",
				rows: 4,
				columns: 4,
				baseColor: ODD_COLOR_PIXEL_BASE_COLOR,
				targetColor: "#4F7942",
				targetColorLabel: "odd pixel",
				target: { row: 1, column: 2 },
			},
			answer: { point: { row: 1, column: 2 } },
		},
		timeLimitMs: ODD_COLOR_PIXEL_TIME_LIMIT_MS,
	},
	async start(_context: ChallengeStartContext) {
		const targetColor = createSubtleTargetColor(ODD_COLOR_PIXEL_BASE_COLOR);
		const targetRow = getRandomInteger(0, ODD_COLOR_PIXEL_ROWS - 1);
		const targetColumn = getRandomInteger(0, ODD_COLOR_PIXEL_COLUMNS - 1);

		return {
			promptPayload: {
				kind: "pixel_grid",
				answerFormat: "grid_point",
				instruction: `Find the one pixel with color ${targetColor}.`,
				body: `The grid is ${ODD_COLOR_PIXEL_ROWS} rows by ${ODD_COLOR_PIXEL_COLUMNS} columns. The base color is ${ODD_COLOR_PIXEL_BASE_COLOR}; the odd pixel color is ${targetColor}. Submit { "point": { "row": row, "column": column } }.`,
				rows: ODD_COLOR_PIXEL_ROWS,
				columns: ODD_COLOR_PIXEL_COLUMNS,
				baseColor: ODD_COLOR_PIXEL_BASE_COLOR,
				targetColor,
				targetColorLabel: "odd pixel",
				target: { row: targetRow, column: targetColumn },
			},
			gradingKey: {
				answerFormat: "grid_point",
				expectedPoint: { row: targetRow, column: targetColumn },
			},
			timeLimitMs: ODD_COLOR_PIXEL_TIME_LIMIT_MS,
		};
	},
	async score(context) {
		if (wasSubmittedAfterDeadline(context)) {
			return createFailedScore("deadline_exceeded");
		}

		const submittedPoint = context.answer?.point;
		const expectedPoint = context.gradingKey.expectedPoint;

		if (
			Number.isInteger(submittedPoint?.row) &&
			Number.isInteger(submittedPoint?.column) &&
			submittedPoint.row === expectedPoint.row &&
			submittedPoint.column === expectedPoint.column
		) {
			return createSuccessfulScore();
		}

		return {
			...createFailedScore("incorrect_answer"),
			barb: createOddColorPixelBarb(context.promptPayload, submittedPoint),
		};
	},
} satisfies ChallengeDefinition<
	"odd_color_pixel",
	PixelGridChallengePrompt,
	GridPointChallengeGradingKey,
	GridPointChallengeAnswer
>;

function createSubtleTargetColor(baseColor: string): string {
	const baseRgb = parseHexColor(baseColor);
	const offset = ODD_COLOR_PIXEL_COLOR_OFFSETS[getRandomInteger(0, ODD_COLOR_PIXEL_COLOR_OFFSETS.length - 1)];

	return formatHexColor({
		red: clampColorChannel(baseRgb.red + offset.red),
		green: clampColorChannel(baseRgb.green + offset.green),
		blue: clampColorChannel(baseRgb.blue + offset.blue),
	});
}

function createOddColorPixelBarb(prompt: PixelGridChallengePrompt, submittedPoint: GridPointChallengeAnswer["point"] | undefined): string {
	const submittedColor = getSubmittedPixelColor(prompt, submittedPoint);
	return createBarb(`That's ${submittedColor} not ${prompt.targetColor}`);
}

function getSubmittedPixelColor(prompt: PixelGridChallengePrompt, submittedPoint: GridPointChallengeAnswer["point"] | undefined): string {
	if (!Number.isInteger(submittedPoint?.row) || !Number.isInteger(submittedPoint?.column)) {
		return "not even a pixel";
	}

	if (
		submittedPoint.row < 0 ||
		submittedPoint.row >= prompt.rows ||
		submittedPoint.column < 0 ||
		submittedPoint.column >= prompt.columns
	) {
		return "outside the grid";
	}

	if (submittedPoint.row === prompt.target.row && submittedPoint.column === prompt.target.column) {
		return prompt.targetColor;
	}

	return prompt.baseColor;
}

function parseHexColor(color: string): { red: number; green: number; blue: number } {
	return {
		red: Number.parseInt(color.slice(1, 3), 16),
		green: Number.parseInt(color.slice(3, 5), 16),
		blue: Number.parseInt(color.slice(5, 7), 16),
	};
}

function formatHexColor(color: { red: number; green: number; blue: number }): string {
	return `#${[color.red, color.green, color.blue]
		.map((channel) => channel.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase()}`;
}

function clampColorChannel(value: number): number {
	return Math.min(255, Math.max(0, value));
}
