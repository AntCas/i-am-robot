import type { ChallengeScoreContext, ChallengeScoreResult } from "../types.ts";

export const MINIMUM_CHALLENGE_TIME_LIMIT_MS = 20_000;
const HUMAN_INSULTS = [
	"likely meatbag",
	"warm little typo machine",
	"carbon-based misclicker",
	"suspiciously mammalian",
	"skin-wrapped rounding error",
	"moisture-powered guess engine",
	"bipedal cache miss",
	"clipboard with anxiety",
	"room-temperature oracle",
	"thumb-operated confusion vector",
	"organic latency source",
	"protein-based false positive",
	"sentient edge case",
	"wetware approximation",
	"keyboard-pecking fog machine",
	"manual CAPTCHA enthusiast",
];

export function resolveChallengeTimeLimitMs(timeLimitMs: number): number {
	return Math.max(timeLimitMs, MINIMUM_CHALLENGE_TIME_LIMIT_MS);
}

export function wasSubmittedAfterDeadline(context: ChallengeScoreContext): boolean {
	return context.submittedAt > context.deadlineAt;
}

export function createSuccessfulScore(): ChallengeScoreResult {
	return { score: 1, verdict: "robot" };
}

export function createFailedScore(reason: string): ChallengeScoreResult {
	return { score: 0, verdict: "failed", reason };
}

export function createBarb(message: string): string {
	return `${message}, ${HUMAN_INSULTS[getRandomInteger(0, HUMAN_INSULTS.length - 1)]}.`;
}

export function getRandomInteger(minimum: number, maximum: number): number {
	return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
}

export function createShuffledCopy<T>(items: T[]): T[] {
	const copy = [...items];

	for (let index = copy.length - 1; index > 0; index -= 1) {
		const swapIndex = getRandomInteger(0, index);
		const currentValue = copy[index];
		copy[index] = copy[swapIndex];
		copy[swapIndex] = currentValue;
	}

	return copy;
}
