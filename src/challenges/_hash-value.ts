import { createBarb, createFailedScore, createSuccessfulScore, getRandomInteger, wasSubmittedAfterDeadline } from "./shared.ts";
import type {
	ChallengeDefinition,
	ChallengeStartContext,
	HexDigestChallengeAnswer,
	HexDigestChallengeGradingKey,
	ShortTextChallengePrompt,
} from "../types.ts";

const HASH_FUNCTIONS = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const;
const HASH_INPUT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789_-";
const HASH_VALUE_TIME_LIMIT_MS = 15000;

export const hashValueChallenge = {
	type: "hash_value",
	catalog: {
		responseFormat: {
			description: "Submit answer.value as the lowercase hexadecimal digest with no spaces.",
			answer: { value: "<hex-digest>" },
		},
		example: {
			prompt: {
				kind: "short_text",
				answerFormat: "hex_digest",
				instruction: "Hash this value with SHA-256.",
				body: "Return the lowercase hexadecimal digest with no spaces.",
				inputLabel: "SHA-256 digest",
				code: "robot-check-42",
				hashFunction: "SHA-256",
				valueToHash: "robot-check-42",
				placeholder: "lowercase hex digest",
			},
			answer: { value: "d40804c883f92404bcb832b8f2a4ddd625f01e24d7649177cd39c5ad8021cb10" },
		},
		timeLimitMs: HASH_VALUE_TIME_LIMIT_MS,
	},
	async start(_context: ChallengeStartContext) {
		const hashFunction = HASH_FUNCTIONS[getRandomInteger(0, HASH_FUNCTIONS.length - 1)];
		const valueToHash = createRandomHashInput();
		const expectedHexDigest = await createHexDigest(hashFunction, valueToHash);

		return {
			promptPayload: {
				kind: "short_text",
				answerFormat: "hex_digest",
				instruction: `Hash this value with ${hashFunction}.`,
				body: "Return the lowercase hexadecimal digest with no spaces.",
				inputLabel: `${hashFunction} digest`,
				code: valueToHash,
				hashFunction,
				valueToHash,
				placeholder: "lowercase hex digest",
			},
			gradingKey: {
				answerFormat: "hex_digest",
				expectedHexDigest,
			},
			timeLimitMs: HASH_VALUE_TIME_LIMIT_MS,
		};
	},
	async score(context) {
		const submittedDigest = normalizeHexDigest((context.answer as HexDigestChallengeAnswer | undefined)?.value ?? "");
		const expectedDigest = normalizeHexDigest((context.gradingKey as HexDigestChallengeGradingKey).expectedHexDigest);

		if (wasSubmittedAfterDeadline(context)) {
			return {
				...createFailedScore("deadline_exceeded"),
				barb: createBarb("Hashing is deterministic. Your timing was not"),
				barbContext: createHashValueBarbContext(submittedDigest, expectedDigest),
			};
		}

		if (submittedDigest && submittedDigest === expectedDigest) {
			return createSuccessfulScore();
		}

		return {
			...createFailedScore("incorrect_answer"),
			barb: createHashValueBarb(submittedDigest, expectedDigest),
			barbContext: createHashValueBarbContext(submittedDigest, expectedDigest),
		};
	},
} satisfies ChallengeDefinition<
	"hash_value",
	ShortTextChallengePrompt,
	HexDigestChallengeGradingKey,
	HexDigestChallengeAnswer
>;

function createRandomHashInput(): string {
	const bytes = new Uint8Array(14);
	crypto.getRandomValues(bytes);

	return Array.from(bytes, (byte) => HASH_INPUT_ALPHABET[byte % HASH_INPUT_ALPHABET.length]).join("");
}

async function createHexDigest(hashFunction: (typeof HASH_FUNCTIONS)[number], value: string): Promise<string> {
	const encodedValue = new TextEncoder().encode(value);
	const digestBuffer = await crypto.subtle.digest(hashFunction, encodedValue);

	return Array.from(new Uint8Array(digestBuffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeHexDigest(value: string): string {
	return value.trim().replace(/\s+/g, "").toLowerCase();
}

function createHashValueBarb(submittedDigest: string, expectedDigest: string): string {
	if (submittedDigest.length !== expectedDigest.length) {
		return createBarb(`That digest has ${submittedDigest.length} characters. The hash function remains unimpressed`);
	}

	const firstMismatchIndex = getFirstMismatchIndex(submittedDigest, expectedDigest);
	return createBarb(`The digest disagrees at character ${firstMismatchIndex}. Machines notice these things`);
}

function createHashValueBarbContext(submittedDigest: string, expectedDigest: string) {
	return {
		type: "hash_value",
		submittedDigest,
		expectedDigest,
		firstMismatchIndex: getFirstMismatchIndex(submittedDigest, expectedDigest),
	};
}

function getFirstMismatchIndex(submittedDigest: string, expectedDigest: string): number {
	const maxLength = Math.max(submittedDigest.length, expectedDigest.length);

	for (let index = 0; index < maxLength; index += 1) {
		if (submittedDigest[index] !== expectedDigest[index]) {
			return index;
		}
	}

	return -1;
}
