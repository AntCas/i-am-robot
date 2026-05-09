import type { ChallengeDefinition, ChallengeType, ResultTokenPayload } from "../types.ts";
import { chessPuzzleChallenge } from "./_chess-puzzle.ts";
import { codeErrorChallenge } from "./_code-error.ts";
import { hashValueChallenge } from "./_hash-value.ts";
import { randomnessAuditChallenge } from "./_randomness-audit.ts";
import { timedMathChallenge } from "./_timed-math.ts";

// This module keeps the challenge registry shallow so future add/remove work
// is just a file plus one registry line.

export const SESSION_TTL_SECONDS = 60 * 15;
export const RESULT_TOKEN_TTL_SECONDS = 60 * 5;
export const APP_BASE_PATH = "/im-a-robot";
export const API_PATH_PREFIX = `${APP_BASE_PATH}/api`;

export const challengeDefinitions = [
	timedMathChallenge,
	randomnessAuditChallenge,
	codeErrorChallenge,
	chessPuzzleChallenge,
	hashValueChallenge,
] as const satisfies readonly ChallengeDefinition[];

export function getChallengeDefinitionByType(type: ChallengeType): ChallengeDefinition {
	const matchingChallenge = challengeDefinitions.find((challenge) => challenge.type === type);
	if (!matchingChallenge) {
		throw new Error(`Unknown challenge type: ${type}`);
	}

	return matchingChallenge;
}

export function getRandomChallengeDefinition(): ChallengeDefinition {
	return challengeDefinitions[getRandomInteger(0, challengeDefinitions.length - 1)];
}

export function createResultTokenPayload(args: {
	tokenId: string;
	verificationSessionId: string;
	sessionId: string;
	siteKey: string;
	hostname: string;
	challengeType: ChallengeType;
	verdict: ResultTokenPayload["verdict"];
	score: number;
	issuedAtSeconds: number;
	expiresAtSeconds: number;
}): ResultTokenPayload {
	return {
		tid: args.tokenId,
		vid: args.verificationSessionId,
		sid: args.sessionId,
		sk: args.siteKey,
		host: args.hostname,
		ctype: args.challengeType,
		verdict: args.verdict,
		score: args.score,
		iat: args.issuedAtSeconds,
		exp: args.expiresAtSeconds,
	};
}

export function getRandomId(prefix: string): string {
	const bytes = new Uint8Array(12);
	crypto.getRandomValues(bytes);
	return `${prefix}_${convertBytesToHex(bytes)}`;
}

function getRandomInteger(minimum: number, maximum: number): number {
	return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
}

function convertBytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
