import { createBarb, createFailedScore, createSuccessfulScore, getRandomInteger, wasSubmittedAfterDeadline } from "./shared.ts";
import type {
	ChallengeDefinition,
	ChallengeStartContext,
	PointClickChallengePrompt,
	PointClickItem,
	PointCoordinate,
	PointsChallengeAnswer,
	PointsChallengeGradingKey,
} from "../types.ts";

const SPOT_THE_TICKS_TIME_LIMIT_MS = 20_000;
const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 420;
const TICK_RADIUS = 5;
const HIT_RADIUS = 24;
const MINIMUM_ITEM_GAP = 72;
const MUFFIN_CENTER = { x: 320, y: 214 };
const MUFFIN_RADIUS_X = 276;
const MUFFIN_RADIUS_Y = 184;
const MUFFIN_IMAGE_URL = "/challenge-assets/lemon-poppy-seed-muffin.webp";
const TICK_IMAGE_URL = "/challenge-assets/tick.svg";

export const spotTheTicksChallenge = {
	type: "spot_the_ticks",
	catalog: {
		responseFormat: {
			description:
				"Submit answer.points as zero-based pixel coordinates on the prompt canvas, one point per tick and no seed clicks.",
			answer: { points: [{ x: 128, y: 96 }] },
		},
		example: {
			prompt: {
				kind: "point_click",
				answerFormat: "points",
				instruction: "Click every tick. Avoid the seed decoys.",
				body: "Coordinates use zero-based pixels from the top-left of the muffin image.",
				width: CANVAS_WIDTH,
				height: CANVAS_HEIGHT,
				targetLabel: "tick",
				backgroundImageUrl: MUFFIN_IMAGE_URL,
				items: [
					{ id: "tick_1", kind: "tick", x: 128, y: 96, radius: TICK_RADIUS, imageUrl: TICK_IMAGE_URL, rotationDegrees: 18 },
				],
			},
			answer: { points: [{ x: 128, y: 96 }] },
		},
		timeLimitMs: SPOT_THE_TICKS_TIME_LIMIT_MS,
	},
	async start(_context: ChallengeStartContext) {
		const tickCount = getRandomInteger(4, 6);
		const tickItems = createRandomItems("tick", tickCount, TICK_RADIUS, []);

		return {
			promptPayload: {
				kind: "point_click",
				answerFormat: "points",
				instruction: "Click every tick hidden on the lemon poppy seed muffin.",
				body: "Coordinates use zero-based pixels from the top-left of the muffin image.",
				width: CANVAS_WIDTH,
				height: CANVAS_HEIGHT,
				targetLabel: "tick",
				backgroundImageUrl: MUFFIN_IMAGE_URL,
				items: tickItems,
			},
			gradingKey: {
				answerFormat: "points",
				expectedPoints: tickItems.map((item) => ({ x: item.x, y: item.y })),
				hitRadius: HIT_RADIUS,
			},
			timeLimitMs: SPOT_THE_TICKS_TIME_LIMIT_MS,
		};
	},
	async score(context) {
		if (wasSubmittedAfterDeadline(context)) {
			return createFailedScore("deadline_exceeded");
		}

		const gradingKey = context.gradingKey as PointsChallengeGradingKey;
		const submittedPoints = (context.answer as PointsChallengeAnswer | undefined)?.points;

		if (!Array.isArray(submittedPoints) || !submittedPoints.every(isFinitePoint)) {
			return createFailedScore("invalid_answer");
		}

		if (matchesEveryTargetExactlyOnce(submittedPoints, gradingKey.expectedPoints, gradingKey.hitRadius)) {
			return createSuccessfulScore();
		}

		const pointMistakes = getPointMistakes(submittedPoints, gradingKey.expectedPoints, gradingKey.hitRadius);
		return {
			...createFailedScore("incorrect_answer"),
			barb: createBarb(
				`You missed ${pointMistakes.missedTargets} ${pluralize("tick", pointMistakes.missedTargets)} and made ${pointMistakes.whiffs} total ${pluralize("whiff", pointMistakes.whiffs)}`,
			),
		};
	},
} satisfies ChallengeDefinition<
	"spot_the_ticks",
	PointClickChallengePrompt,
	PointsChallengeGradingKey,
	PointsChallengeAnswer
>;

function createRandomItems(
	kind: PointClickItem["kind"],
	count: number,
	radius: number,
	existingItems: PointClickItem[],
): PointClickItem[] {
	const items: PointClickItem[] = [];

	for (let index = 0; index < count; index += 1) {
		const point = createNonOverlappingPoint([...existingItems, ...items], radius);

		items.push({
			id: `${kind}_${index + 1}`,
			kind,
			x: point.x,
			y: point.y,
			radius,
			imageUrl: kind === "tick" ? TICK_IMAGE_URL : undefined,
			rotationDegrees: getRandomInteger(0, 359),
		});
	}

	return items;
}

function createNonOverlappingPoint(existingItems: PointClickItem[], radius: number): PointCoordinate {
	const margin = Math.max(radius + HIT_RADIUS, MINIMUM_ITEM_GAP);

	for (let attempt = 0; attempt < 300; attempt += 1) {
		const point = {
			x: getRandomInteger(margin, CANVAS_WIDTH - margin),
			y: getRandomInteger(margin, CANVAS_HEIGHT - margin),
		};

		if (isInsideMuffin(point) && existingItems.every((item) => getDistance(point, item) >= MINIMUM_ITEM_GAP)) {
			return point;
		}
	}

	throw new Error("Unable to place spot_the_ticks items without overlap");
}

function matchesEveryTargetExactlyOnce(
	submittedPoints: PointCoordinate[],
	expectedPoints: PointCoordinate[],
	hitRadius: number,
): boolean {
	const matchedTargetIndexes = new Set<number>();

	for (const point of submittedPoints) {
		const targetIndex = expectedPoints.findIndex(
			(target, index) => !matchedTargetIndexes.has(index) && getDistance(point, target) <= hitRadius,
		);

		if (targetIndex === -1) {
			return false;
		}

		matchedTargetIndexes.add(targetIndex);
	}

	return matchedTargetIndexes.size === expectedPoints.length;
}

function getPointMistakes(
	submittedPoints: PointCoordinate[],
	expectedPoints: PointCoordinate[],
	hitRadius: number,
): { missedTargets: number; whiffs: number } {
	const matchedTargetIndexes = new Set<number>();
	let whiffs = 0;

	for (const point of submittedPoints) {
		const targetIndex = expectedPoints.findIndex(
			(target, index) => !matchedTargetIndexes.has(index) && getDistance(point, target) <= hitRadius,
		);

		if (targetIndex === -1) {
			if (expectedPoints.every((target) => getDistance(point, target) > hitRadius)) {
				whiffs += 1;
			}
			continue;
		}

		matchedTargetIndexes.add(targetIndex);
	}

	return {
		missedTargets: expectedPoints.length - matchedTargetIndexes.size,
		whiffs,
	};
}

function pluralize(word: string, count: number): string {
	return count === 1 ? word : `${word}s`;
}

function isFinitePoint(point: PointCoordinate): boolean {
	return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function isInsideMuffin(point: PointCoordinate): boolean {
	const normalizedX = (point.x - MUFFIN_CENTER.x) / MUFFIN_RADIUS_X;
	const normalizedY = (point.y - MUFFIN_CENTER.y) / MUFFIN_RADIUS_Y;
	return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
}

function getDistance(firstPoint: PointCoordinate, secondPoint: PointCoordinate): number {
	return Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y);
}
