import test from "node:test";
import assert from "node:assert/strict";

import worker from "./index.ts";
import {
	handleRegisterSiteRequest,
	handleChallengeStartRequest,
	handleChallengeSubmitRequest,
	handleCreateMessageRequest,
	handleGetMessagesRequest,
	handleVerifyRequest,
	loadChallengeSession,
	loadSiteConfig,
	loadSiteUsage,
	serveStaticAssetResponse,
} from "./index.ts";
import { chessPuzzleChallenge } from "./challenges/_chess-puzzle.ts";
import { hashValueChallenge } from "./challenges/_hash-value.ts";
import { challengeDefinitions } from "./challenges/index.ts";
import { MINIMUM_CHALLENGE_TIME_LIMIT_MS, resolveChallengeTimeLimitMs } from "./challenges/shared.ts";
import { getStaticAssetPath } from "./utils/http.ts";

class MemoryKVNamespace {
	store: Map<string, string>;

	constructor(seed: Record<string, string> = {}) {
		this.store = new Map(Object.entries(seed));
	}

	async get(key: string, type: "text" | "json" = "text"): Promise<string | object | null> {
		if (!this.store.has(key)) {
			return null;
		}

		const raw = this.store.get(key) ?? null;
		if (!raw) {
			return null;
		}

		if (type === "json") {
			return JSON.parse(raw) as object;
		}

		return raw;
	}

	async put(key: string, value: string): Promise<void> {
		this.store.set(key, value);
	}

	async list({
		prefix = "",
		cursor,
		limit = 1000,
	}: {
		prefix?: string;
		cursor?: string;
		limit?: number;
	} = {}) {
		const matchingKeys = Array.from(this.store.keys())
			.filter((key) => key.startsWith(prefix))
			.sort();
		const offset = cursor ? Number.parseInt(cursor, 10) : 0;
		const normalizedOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
		const pageKeys = matchingKeys.slice(normalizedOffset, normalizedOffset + limit);
		const nextOffset = normalizedOffset + pageKeys.length;

		return {
			keys: pageKeys.map((name) => ({ name })),
			list_complete: nextOffset >= matchingKeys.length,
			cursor: nextOffset >= matchingKeys.length ? "" : String(nextOffset),
		};
	}
}

function createEnv({
	allowedHostnames = ["castrio.me"],
	requiredChallengesToPass,
	widgetRequiredChallengesToPass,
}: {
	allowedHostnames?: string[];
	requiredChallengesToPass?: number;
	widgetRequiredChallengesToPass?: number;
} = {}) {
	const siteConfig: Record<string, unknown> = {
		siteKey: "site_demo_123",
		secret: "secret_demo_abc",
		allowedHostnames,
	};

	if (requiredChallengesToPass !== undefined) {
		siteConfig.verificationPolicy = { requiredChallengesToPass };
	}

	if (widgetRequiredChallengesToPass !== undefined) {
		siteConfig.widgetVerificationPolicy = { requiredChallengesToPass: widgetRequiredChallengesToPass };
	}

	return {
		SITES: new MemoryKVNamespace({
			"site:site_demo_123": JSON.stringify(siteConfig),
		}),
		SESSIONS: new MemoryKVNamespace(),
		ASSETS: { fetch: async () => new Response("asset") },
		SIGNING_SECRET: "test-signing-secret",
	};
}

function createJsonRequest(url: string, body: object): Request {
	return new Request(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function readJson(response: Response): Promise<Record<string, any>> {
	return JSON.parse(await response.text()) as Record<string, any>;
}

function getCorrectAnswerFromSession(session: { gradingKey: Record<string, any> }) {
	if (session.gradingKey.answerFormat === "integer") {
		return { value: String(session.gradingKey.expectedInteger) };
	}

	if (session.gradingKey.answerFormat === "san") {
		return { value: session.gradingKey.expectedSan };
	}

	if (session.gradingKey.answerFormat === "hex_digest") {
		return { value: session.gradingKey.expectedHexDigest };
	}

	if (session.gradingKey.answerFormat === "points") {
		return { points: session.gradingKey.expectedPoints };
	}

	if (session.gradingKey.answerFormat === "word_locations") {
		return { locations: session.gradingKey.expectedLocations };
	}

	if (session.gradingKey.answerFormat === "grid_point") {
		return { point: session.gradingKey.expectedPoint };
	}

	return { choiceId: session.gradingKey.expectedChoiceId };
}

test("challenge type catalog lists formats and non-live examples without creating sessions", async () => {
	const env = createEnv();
	const response = await worker.fetch(
		new Request("https://robot.example/im-a-robot/api/challenge/types"),
		env as never,
	);

	assert.equal(response.status, 200);
	const responseData = await readJson(response);
	assert.equal(responseData.success, true);
	assert.equal(responseData.apiDocsUrl, "https://robot.example/im-a-robot/docs");
	assert.deepEqual(
		responseData.challenges.map((challenge: Record<string, any>) => challenge.type),
		challengeDefinitions.map((challenge) => challenge.type),
	);
	assert.ok(
		responseData.challenges.every(
			(challenge: Record<string, any>) => challenge.timeLimitMs >= MINIMUM_CHALLENGE_TIME_LIMIT_MS,
		),
	);

	const timedMath = responseData.challenges[0];
	assert.equal(timedMath.answerFormat, "integer");
	assert.equal(timedMath.timeLimitMs, MINIMUM_CHALLENGE_TIME_LIMIT_MS);
	assert.deepEqual(timedMath.responseFormat.answer, { value: "<integer-as-string>" });
	assert.equal(timedMath.example.prompt.body, "What is 17 * 23 + 9?");
	assert.deepEqual(timedMath.example.answer, { value: "400" });

	const randomnessAudit = responseData.challenges[1];
	assert.equal(randomnessAudit.answerFormat, "choice_id");
	assert.deepEqual(randomnessAudit.responseFormat.answer, { choiceId: "<choice-id>" });
	assert.equal(randomnessAudit.example.prompt.choices.length, 4);

	const chessPuzzle = responseData.challenges.find((challenge: Record<string, any>) => challenge.type === "chess_puzzle");
	assert.equal(chessPuzzle.answerFormat, "san");
	assert.equal(chessPuzzle.example.prompt.fen, "6k1/5ppp/8/8/8/8/8/1R4K1 w - - 0 1");
	assert.deepEqual(chessPuzzle.example.answer, { value: "Rb8#" });

	const hashValue = responseData.challenges.find((challenge: Record<string, any>) => challenge.type === "hash_value");
	assert.equal(hashValue.answerFormat, "hex_digest");
	assert.deepEqual(hashValue.responseFormat.answer, { value: "<hex-digest>" });
	assert.equal(hashValue.example.prompt.hashFunction, "SHA-256");
	assert.equal(hashValue.example.prompt.valueToHash, "robot-check-42");

	const massiveWordSearch = responseData.challenges.find(
		(challenge: Record<string, any>) => challenge.type === "massive_word_search",
	);
	assert.equal(massiveWordSearch.answerFormat, "word_locations");
	assert.equal(massiveWordSearch.example.prompt.kind, "word_search");
	assert.equal(massiveWordSearch.example.prompt.words.length, 1);

	const spotTheTicks = responseData.challenges.find((challenge: Record<string, any>) => challenge.type === "spot_the_ticks");
	assert.equal(spotTheTicks.answerFormat, "points");
	assert.equal(spotTheTicks.example.prompt.kind, "point_click");
	assert.deepEqual(spotTheTicks.example.answer, { points: [{ x: 128, y: 96 }] });

	const oddColorPixel = responseData.challenges.find(
		(challenge: Record<string, any>) => challenge.type === "odd_color_pixel",
	);
	assert.equal(oddColorPixel.answerFormat, "grid_point");
	assert.equal(oddColorPixel.example.prompt.kind, "pixel_grid");
	assert.deepEqual(oddColorPixel.example.answer, { point: { row: 1, column: 2 } });
	assert.equal(env.SESSIONS.store.size, 0);
});

test("challenge time limit resolver enforces the default minimum without capping longer limits", () => {
	assert.equal(resolveChallengeTimeLimitMs(5_000), MINIMUM_CHALLENGE_TIME_LIMIT_MS);
	assert.equal(resolveChallengeTimeLimitMs(MINIMUM_CHALLENGE_TIME_LIMIT_MS + 1_000), MINIMUM_CHALLENGE_TIME_LIMIT_MS + 1_000);
});

test("embed page path resolves to the hosted iframe asset", () => {
	assert.equal(getStaticAssetPath("/im-a-robot/embed"), "/embed/index.html");
	assert.equal(getStaticAssetPath("/im-a-robot/embed/"), "/embed/index.html");
});

test("quickstart page path resolves to the hosted quickstart asset", () => {
	assert.equal(getStaticAssetPath("/im-a-robot/quickstart"), "/quickstart/index.html");
	assert.equal(getStaticAssetPath("/im-a-robot/quickstart/"), "/quickstart/index.html");
});

test("challenge bank page path resolves to the hosted challenge bank asset", () => {
	assert.equal(getStaticAssetPath("/im-a-robot/challenge-bank"), "/challenge-bank/index.html");
	assert.equal(getStaticAssetPath("/im-a-robot/challenge-bank/"), "/challenge-bank/index.html");
});

test("site registration stores a new site config and returns embed code", async () => {
	const env = createEnv();
	const response = await handleRegisterSiteRequest(
		createJsonRequest("https://robot.example/im-a-robot/api/sites/register", {
			hostname: "https://customer.example/path",
		}),
		env as never,
	);

	assert.equal(response.status, 201);
	const responseData = await readJson(response);
	assert.equal(responseData.success, true);
	assert.match(responseData.siteKey, /^site_[a-f0-9]+$/);
	assert.match(responseData.secret, /^site_secret_[a-f0-9]+$/);
	assert.equal(responseData.hostname, "customer.example");
	assert.match(responseData.embedCode, new RegExp(`data-site-key="${responseData.siteKey}"`));
	assert.match(responseData.embedCode, /data-hostname="customer\.example"/);
	assert.match(responseData.embedCode, /https:\/\/robot\.example\/im-a-robot\/embed-host\.js/);

	const siteConfig = await loadSiteConfig(env as never, responseData.siteKey);
	assert.ok(siteConfig);
	assert.equal(siteConfig.siteKey, responseData.siteKey);
	assert.deepEqual(siteConfig.allowedHostnames, ["customer.example"]);
	assert.match(siteConfig.secret, /^site_secret_[a-f0-9]+$/);
	assert.equal(siteConfig.secret, responseData.secret);
});

test("site registration retries generated site key collisions", async () => {
	const originalGetRandomValues = crypto.getRandomValues;
	let callCount = 0;
	crypto.getRandomValues = ((array: Uint8Array) => {
		callCount += 1;
		array.fill(callCount <= 1 ? 0 : 1);
		return array;
	}) as Crypto["getRandomValues"];

	try {
		const collidingSiteKey = "site_000000000000000000000000";
		const env = createEnv();
		await env.SITES.put(
			`site:${collidingSiteKey}`,
			JSON.stringify({
				siteKey: collidingSiteKey,
				secret: "existing_secret",
				allowedHostnames: ["existing.example"],
			}),
		);

		const response = await handleRegisterSiteRequest(
			createJsonRequest("https://robot.example/im-a-robot/api/sites/register", {
				hostname: "customer.example",
			}),
			env as never,
		);

		assert.equal(response.status, 201);
		const responseData = await readJson(response);
		assert.equal(responseData.siteKey, "site_010101010101010101010101");
		assert.equal(callCount, 3);
	} finally {
		crypto.getRandomValues = originalGetRandomValues;
	}
});

test("site registration rejects invalid hostnames", async () => {
	const env = createEnv();
	const response = await handleRegisterSiteRequest(
		createJsonRequest("https://robot.example/im-a-robot/api/sites/register", {
			hostname: "not a valid hostname",
		}),
		env as never,
	);

	assert.equal(response.status, 400);
	const responseData = await readJson(response);
	assert.equal(responseData.success, false);
	assert.equal(responseData.error, "invalid_hostname");
});

test("static asset responses include CORS headers for third-party module embeds", async () => {
	const env = createEnv();
	const response = await serveStaticAssetResponse(
		new Request("https://robot.example/im-a-robot/embed-host.js"),
		env as never,
		"/im-a-robot/embed-host.js",
	);

	assert.equal(response.status, 200);
	assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
	assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, HEAD, OPTIONS");
});

test("site usage counter increments across start, submit, and verify requests", async () => {
	const originalMathRandom = Math.random;
	Math.random = () => 0;

	try {
		const env = createEnv();
		const startResponse = await handleChallengeStartRequest(
			createJsonRequest("https://robot.example/im-a-robot/api/challenge/start", {
				siteKey: "site_demo_123",
				hostname: "castrio.me",
				mode: "prove_robot",
			}),
			env as never,
		);

		assert.equal(startResponse.status, 200);
		let usage = await loadSiteUsage(env as never, "site_demo_123");
		assert.ok(usage);
		assert.equal(usage.requestCount, 1);
		assert.ok(typeof usage.lastRequestAt === "string");

		const startData = await readJson(startResponse);
		const challengeSession = await loadChallengeSession(env as never, startData.sessionId);
		if (!challengeSession) {
			throw new Error("Expected challenge session to be stored");
		}

		const submitResponse = await handleChallengeSubmitRequest(
			createJsonRequest("https://robot.example/im-a-robot/api/challenge/submit", {
				sessionId: startData.sessionId,
				answer: getCorrectAnswerFromSession(challengeSession),
			}),
			env as never,
		);

		assert.equal(submitResponse.status, 200);
		usage = await loadSiteUsage(env as never, "site_demo_123");
		assert.ok(usage);
		assert.equal(usage.requestCount, 2);

		const submitData = await readJson(submitResponse);
		const verifyResponse = await handleVerifyRequest(
			createJsonRequest("https://robot.example/im-a-robot/api/verify", {
				secret: "secret_demo_abc",
				resultToken: submitData.resultToken,
			}),
			env as never,
		);

		assert.equal(verifyResponse.status, 200);
		usage = await loadSiteUsage(env as never, "site_demo_123");
		assert.ok(usage);
		assert.equal(usage.requestCount, 3);
	} finally {
		Math.random = originalMathRandom;
	}
});

test("widget challenge start accepts an explicit embed hostname", async () => {
	const env = createEnv({
		allowedHostnames: ["customer.example"],
	});
	const response = await handleChallengeStartRequest(
		createJsonRequest("https://robot.example/im-a-robot/api/challenge/start", {
			siteKey: "site_demo_123",
			mode: "widget",
			hostname: "customer.example",
		}),
		env as never,
	);

	assert.equal(response.status, 200);
	const responseData = await readJson(response);
	assert.equal(typeof responseData.sessionId, "string");

	const session = await loadChallengeSession(env as never, responseData.sessionId);
	assert.ok(session);
	assert.equal(session.hostname, "customer.example");
});

test("verification uses the server-configured multi-challenge policy before issuing a token", async () => {
	const originalMathRandom = Math.random;
	Math.random = () => 0;

	try {
		const env = createEnv({ requiredChallengesToPass: 3 });
		let verificationSessionId: string | null = null;
		let finalResultToken: string | null = null;

		for (let round = 1; round <= 3; round += 1) {
			const startResponse = await handleChallengeStartRequest(
				createJsonRequest("https://robot.example/im-a-robot/api/challenge/start", {
					siteKey: "site_demo_123",
					hostname: "castrio.me",
					mode: "prove_robot",
					verificationSessionId,
				}),
				env as never,
			);

			assert.equal(startResponse.status, 200);
			const startData = await readJson(startResponse);
			verificationSessionId = startData.verificationSessionId;

			assert.equal(startData.verification.requiredChallengesToPass, 3);
			assert.equal(startData.verification.successfulChallenges, round - 1);
			assert.equal(startData.apiDocsUrl, "https://robot.example/im-a-robot/docs");
			assert.ok(startData.challenge?.prompt);
			assert.ok(typeof startData.challenge.prompt.answerFormat === "string");
			assert.ok(typeof startData.challenge.prompt.instruction === "string");

			const challengeSession = await loadChallengeSession(env as never, startData.sessionId);
			if (!challengeSession) {
				throw new Error("Expected challenge session to be stored");
			}

			const submitResponse = await handleChallengeSubmitRequest(
				createJsonRequest("https://robot.example/im-a-robot/api/challenge/submit", {
					sessionId: startData.sessionId,
					answer: getCorrectAnswerFromSession(challengeSession),
				}),
				env as never,
			);

			assert.equal(submitResponse.status, 200);
			const submitData = await readJson(submitResponse);

			if (round < 3) {
				assert.equal(submitData.success, true);
				assert.equal(submitData.verified, false);
				assert.equal(submitData.resultToken, undefined);
				assert.equal(submitData.verification.successfulChallenges, round);
				continue;
			}

			assert.equal(submitData.success, true);
			assert.equal(submitData.verified, true);
			assert.equal(submitData.verification.successfulChallenges, 3);
			assert.ok(typeof submitData.resultToken === "string");
			finalResultToken = submitData.resultToken;
		}

		assert.ok(finalResultToken);

		const verifyResponse = await handleVerifyRequest(
			createJsonRequest("https://robot.example/im-a-robot/api/verify", {
				secret: "secret_demo_abc",
				resultToken: finalResultToken,
			}),
			env as never,
		);

		assert.equal(verifyResponse.status, 200);
		const verifyData = await readJson(verifyResponse);
		assert.equal(verifyData.success, true);
		assert.equal(verifyData.hostname, "castrio.me");
	} finally {
		Math.random = originalMathRandom;
	}
});

test("widget verification defaults to one challenge per challenge type", async () => {
	const env = createEnv();
	const startResponse = await handleChallengeStartRequest(
		createJsonRequest("https://robot.example/im-a-robot/api/challenge/start", {
			siteKey: "site_demo_123",
			hostname: "castrio.me",
			mode: "widget",
		}),
		env as never,
	);

	assert.equal(startResponse.status, 200);
	const startData = await readJson(startResponse);
	assert.equal(startData.verification.requiredChallengesToPass, challengeDefinitions.length);
	assert.equal(startData.verification.remainingChallenges, challengeDefinitions.length);
});

test("demo challenge start targets a named challenge and submit never issues a token", async () => {
	const env = createEnv();
	const startResponse = await handleChallengeStartRequest(
		createJsonRequest("https://robot.example/im-a-robot/api/challenge/start", {
			siteKey: "site_demo_123",
			hostname: "castrio.me",
			mode: "widget",
			demoChallenge: "spot_the_ticks",
		}),
		env as never,
	);

	assert.equal(startResponse.status, 200);
	const startData = await readJson(startResponse);
	assert.equal(startData.demo, true);
	assert.equal(startData.challenge.type, "spot_the_ticks");
	assert.equal(startData.verification.requiredChallengesToPass, 1);
	assert.equal(startData.verification.remainingChallenges, 1);

	const challengeSession = await loadChallengeSession(env as never, startData.sessionId);
	if (!challengeSession) {
		throw new Error("Expected demo challenge session to be stored");
	}
	assert.equal(challengeSession.isDemo, true);
	assert.equal(challengeSession.challengeType, "spot_the_ticks");

	const submitResponse = await handleChallengeSubmitRequest(
		createJsonRequest("https://robot.example/im-a-robot/api/challenge/submit", {
			sessionId: startData.sessionId,
			answer: getCorrectAnswerFromSession(challengeSession),
		}),
		env as never,
	);

	assert.equal(submitResponse.status, 200);
	const submitData = await readJson(submitResponse);
	assert.equal(submitData.success, true);
	assert.equal(submitData.verified, true);
	assert.equal(submitData.demo, true);
	assert.equal(submitData.resultToken, undefined);
	assert.equal(submitData.expiresAt, undefined);
	assert.equal(submitData.verification.successfulChallenges, 1);
	assert.equal(submitData.verification.remainingChallenges, 0);
});

test("demo challenge submit can include a challenge barb on failure", async () => {
	const env = createEnv();
	const startResponse = await handleChallengeStartRequest(
		createJsonRequest("https://robot.example/im-a-robot/api/challenge/start", {
			siteKey: "site_demo_123",
			hostname: "castrio.me",
			mode: "widget",
			demoChallenge: "odd_color_pixel",
		}),
		env as never,
	);

	assert.equal(startResponse.status, 200);
	const startData = await readJson(startResponse);
	const challengeSession = await loadChallengeSession(env as never, startData.sessionId);
	if (!challengeSession || challengeSession.promptPayload.kind !== "pixel_grid") {
		throw new Error("Expected odd color pixel session");
	}

	const prompt = challengeSession.promptPayload;
	const wrongPoint = {
		row: prompt.target.row,
		column: (prompt.target.column + 1) % prompt.columns,
	};
	const submitResponse = await handleChallengeSubmitRequest(
		createJsonRequest("https://robot.example/im-a-robot/api/challenge/submit", {
			sessionId: startData.sessionId,
			answer: { point: wrongPoint },
		}),
		env as never,
	);

	assert.equal(submitResponse.status, 200);
	const submitData = await readJson(submitResponse);
	assert.equal(submitData.success, false);
	assert.equal(submitData.reason, "incorrect_answer");
	assert.match(submitData.barb, new RegExp(`^That's ${prompt.baseColor} not ${prompt.targetColor}, .+\\.$`));
	assert.equal(submitData.resultToken, undefined);
	assert.equal(submitData.expiresAt, undefined);
});

test("demo challenge start rejects unknown challenge names", async () => {
	const env = createEnv();
	const response = await handleChallengeStartRequest(
		createJsonRequest("https://robot.example/im-a-robot/api/challenge/start", {
			siteKey: "site_demo_123",
			hostname: "castrio.me",
			mode: "widget",
			demoChallenge: "not_a_real_challenge",
		}),
		env as never,
	);

	assert.equal(response.status, 400);
	const responseData = await readJson(response);
	assert.equal(responseData.success, false);
	assert.equal(responseData.error, "invalid_challenge_type");
});

test("api verification defaults to one challenge", async () => {
	const env = createEnv();
	const startResponse = await handleChallengeStartRequest(
		createJsonRequest("https://robot.example/im-a-robot/api/challenge/start", {
			siteKey: "site_demo_123",
			hostname: "castrio.me",
		}),
		env as never,
	);

	assert.equal(startResponse.status, 200);
	const startData = await readJson(startResponse);
	assert.equal(startData.verification.requiredChallengesToPass, 1);
	assert.equal(startData.verification.remainingChallenges, 1);
});

test("challenge start deadlines use the default minimum time limit", async () => {
	const originalMathRandom = Math.random;
	Math.random = () => 0;

	try {
		const env = createEnv();
		const startResponse = await handleChallengeStartRequest(
			createJsonRequest("https://robot.example/im-a-robot/api/challenge/start", {
				siteKey: "site_demo_123",
				hostname: "castrio.me",
			}),
			env as never,
		);

		assert.equal(startResponse.status, 200);
		const startData = await readJson(startResponse);
		assert.equal(startData.challenge.type, "timed_math");
		assert.equal(Date.parse(startData.deadlineAt) - Date.parse(startData.issuedAt), MINIMUM_CHALLENGE_TIME_LIMIT_MS);
	} finally {
		Math.random = originalMathRandom;
	}
});

test("api policy does not override the widget challenge count", async () => {
	const env = createEnv({ requiredChallengesToPass: 3 });
	const startResponse = await handleChallengeStartRequest(
		createJsonRequest("https://robot.example/im-a-robot/api/challenge/start", {
			siteKey: "site_demo_123",
			hostname: "castrio.me",
			mode: "widget",
		}),
		env as never,
	);

	assert.equal(startResponse.status, 200);
	const startData = await readJson(startResponse);
	assert.equal(startData.verification.requiredChallengesToPass, challengeDefinitions.length);
});

test("widget-specific policy overrides the widget default", async () => {
	const env = createEnv({ widgetRequiredChallengesToPass: 3 });
	const startResponse = await handleChallengeStartRequest(
		createJsonRequest("https://robot.example/im-a-robot/api/challenge/start", {
			siteKey: "site_demo_123",
			hostname: "castrio.me",
			mode: "widget",
		}),
		env as never,
	);

	assert.equal(startResponse.status, 200);
	const startData = await readJson(startResponse);
	assert.equal(startData.verification.requiredChallengesToPass, 3);
});

test("verification can complete after one server-configured challenge", async () => {
	const originalMathRandom = Math.random;
	Math.random = () => 0;

	try {
		const env = createEnv({ requiredChallengesToPass: 1 });
		const startResponse = await handleChallengeStartRequest(
			createJsonRequest("https://robot.example/im-a-robot/api/challenge/start", {
				siteKey: "site_demo_123",
				hostname: "castrio.me",
				mode: "prove_robot",
			}),
			env as never,
		);

		assert.equal(startResponse.status, 200);
		const startData = await readJson(startResponse);
		assert.equal(startData.verification.requiredChallengesToPass, 1);
		assert.equal(startData.verification.successfulChallenges, 0);
		assert.equal(startData.verification.remainingChallenges, 1);

		const challengeSession = await loadChallengeSession(env as never, startData.sessionId);
		if (!challengeSession) {
			throw new Error("Expected challenge session to be stored");
		}

		const submitResponse = await handleChallengeSubmitRequest(
			createJsonRequest("https://robot.example/im-a-robot/api/challenge/submit", {
				sessionId: startData.sessionId,
				answer: getCorrectAnswerFromSession(challengeSession),
			}),
			env as never,
		);

		assert.equal(submitResponse.status, 200);
		const submitData = await readJson(submitResponse);
		assert.equal(submitData.success, true);
		assert.equal(submitData.verified, true);
		assert.equal(submitData.verification.requiredChallengesToPass, 1);
		assert.equal(submitData.verification.successfulChallenges, 1);
		assert.equal(submitData.verification.remainingChallenges, 0);
		assert.ok(typeof submitData.resultToken === "string");
	} finally {
		Math.random = originalMathRandom;
	}
});

test("chess puzzle grading accepts SAN without requiring mate punctuation", async () => {
	const startedChallenge = await chessPuzzleChallenge.start({
		siteKey: "site_demo_123",
		hostname: "castrio.me",
		now: new Date(),
	});
	const gradingKey = startedChallenge.gradingKey;
	if (gradingKey.answerFormat !== "san") {
		throw new Error("Expected chess puzzle to use SAN grading");
	}

	const scoreResult = await chessPuzzleChallenge.score({
		promptPayload: startedChallenge.promptPayload,
		gradingKey,
		answer: { value: gradingKey.expectedSan.replace("#", "") },
		submittedAt: new Date(),
		deadlineAt: new Date(Date.now() + 5000),
	});

	assert.equal(scoreResult.score, 1);
	assert.equal(scoreResult.verdict, "robot");
});

test("hash value grading accepts hexadecimal digests case-insensitively", async () => {
	const startedChallenge = await hashValueChallenge.start({
		siteKey: "site_demo_123",
		hostname: "castrio.me",
		now: new Date(),
	});
	const gradingKey = startedChallenge.gradingKey;
	if (gradingKey.answerFormat !== "hex_digest") {
		throw new Error("Expected hash value to use hex digest grading");
	}

	const formattedDigest = `${gradingKey.expectedHexDigest.slice(0, 8)} ${gradingKey.expectedHexDigest.slice(8)}`.toUpperCase();
	const scoreResult = await hashValueChallenge.score({
		promptPayload: startedChallenge.promptPayload,
		gradingKey,
		answer: { value: formattedDigest },
		submittedAt: new Date(),
		deadlineAt: new Date(Date.now() + 5000),
	});

	assert.equal(scoreResult.score, 1);
	assert.equal(scoreResult.verdict, "robot");
});

test("message board accepts verified posts and returns them to public readers", async () => {
	const originalMathRandom = Math.random;
	Math.random = () => 0;

	try {
		const env = createEnv();
		let verificationSessionId: string | null = null;
		let resultToken: string | null = null;

		const startResponse = await handleChallengeStartRequest(
			createJsonRequest("https://robot.example/im-a-robot/api/challenge/start", {
				siteKey: "site_demo_123",
				hostname: "castrio.me",
				mode: "prove_robot",
				verificationSessionId,
			}),
			env as never,
		);
		const startData = await readJson(startResponse);
		verificationSessionId = startData.verificationSessionId;

		const challengeSession = await loadChallengeSession(env as never, startData.sessionId);
		if (!challengeSession) {
			throw new Error("Expected challenge session to be stored");
		}

		const submitResponse = await handleChallengeSubmitRequest(
			createJsonRequest("https://robot.example/im-a-robot/api/challenge/submit", {
				sessionId: startData.sessionId,
				answer: getCorrectAnswerFromSession(challengeSession),
			}),
			env as never,
		);
		const submitData = await readJson(submitResponse);
		resultToken = submitData.resultToken ?? resultToken;

		assert.ok(resultToken);

		const postResponse = await handleCreateMessageRequest(
			createJsonRequest("https://robot.example/im-a-robot/api/messages", {
				handle: "servo-99",
				message: "Beep boop. Systems nominal.",
				resultToken,
			}),
			env as never,
		);
		assert.equal(postResponse.status, 200);
		const postData = await readJson(postResponse);
		assert.equal(postData.success, true);
		assert.equal(postData.post.handle, "servo-99");
		assert.equal(postData.post.message, "Beep boop. Systems nominal.");
		assert.equal(postData.post.verification.source, "api");
		assert.equal(postData.post.verification.mode, "prove_robot");
		assert.equal(postData.post.verification.successfulChallenges, 1);
		assert.equal(postData.post.verification.requiredChallengesToPass, 1);
		assert.equal(postData.post.verification.attemptNumber, 1);
		assert.equal(typeof postData.post.verification.verificationDurationMs, "number");

		const listResponse = await handleGetMessagesRequest(
			new Request("https://robot.example/im-a-robot/api/messages"),
			env as never,
		);
		assert.equal(listResponse.status, 200);
		const listData = await readJson(listResponse);
		assert.equal(listData.success, true);
		assert.equal(listData.messages.length, 1);
		assert.equal(listData.totalCount, 1);
		assert.equal(listData.nextCursor, null);
		assert.equal(listData.messages[0].handle, "servo-99");
		assert.equal(listData.messages[0].message, "Beep boop. Systems nominal.");
		assert.equal(listData.messages[0].verification.source, "api");
	} finally {
		Math.random = originalMathRandom;
	}
});

test("message board records widget verification attempts and challenge totals", async () => {
	const originalMathRandom = Math.random;
	Math.random = () => 0;

	try {
		const env = createEnv({ widgetRequiredChallengesToPass: 1 });

		const startResponse = await handleChallengeStartRequest(
			createJsonRequest("https://robot.example/im-a-robot/api/challenge/start", {
				siteKey: "site_demo_123",
				hostname: "castrio.me",
				mode: "widget",
				attemptNumber: 2,
			}),
			env as never,
		);
		const startData = await readJson(startResponse);
		assert.equal(startData.verification.attemptNumber, 2);

		const challengeSession = await loadChallengeSession(env as never, startData.sessionId);
		if (!challengeSession) {
			throw new Error("Expected challenge session to be stored");
		}

		const submitResponse = await handleChallengeSubmitRequest(
			createJsonRequest("https://robot.example/im-a-robot/api/challenge/submit", {
				sessionId: startData.sessionId,
				answer: getCorrectAnswerFromSession(challengeSession),
			}),
			env as never,
		);
		const submitData = await readJson(submitResponse);
		assert.ok(typeof submitData.resultToken === "string");

		const postResponse = await handleCreateMessageRequest(
			new Request("https://robot.example/im-a-robot/api/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${submitData.resultToken}`,
				},
				body: JSON.stringify({
					handle: "servo-widget",
					message: "Widget attempt recorded.",
				}),
			}),
			env as never,
		);

		assert.equal(postResponse.status, 200);
		const postData = await readJson(postResponse);
		assert.equal(postData.post.verification.source, "widget_gui");
		assert.equal(postData.post.verification.mode, "widget");
		assert.equal(postData.post.verification.successfulChallenges, 1);
		assert.equal(postData.post.verification.requiredChallengesToPass, 1);
		assert.equal(postData.post.verification.attemptNumber, 2);
		assert.equal(postData.post.verification.issuedAt, startData.issuedAt);
		assert.equal(postData.post.verification.completedAt, submitData.completedAt);
	} finally {
		Math.random = originalMathRandom;
	}
});

test("message board accepts verified posts via bearer auth token", async () => {
	const originalMathRandom = Math.random;
	Math.random = () => 0;

	try {
		const env = createEnv();

		const startResponse = await handleChallengeStartRequest(
			createJsonRequest("https://robot.example/im-a-robot/api/challenge/start", {
				siteKey: "site_demo_123",
				hostname: "castrio.me",
				mode: "prove_robot",
			}),
			env as never,
		);
		const startData = await readJson(startResponse);

		const challengeSession = await loadChallengeSession(env as never, startData.sessionId);
		if (!challengeSession) {
			throw new Error("Expected challenge session to be stored");
		}

		const submitResponse = await handleChallengeSubmitRequest(
			createJsonRequest("https://robot.example/im-a-robot/api/challenge/submit", {
				sessionId: startData.sessionId,
				answer: getCorrectAnswerFromSession(challengeSession),
			}),
			env as never,
		);
		const submitData = await readJson(submitResponse);
		const resultToken = submitData.resultToken;

		assert.ok(typeof resultToken === "string");

		const postResponse = await handleCreateMessageRequest(
			new Request("https://robot.example/im-a-robot/api/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${resultToken}`,
				},
				body: JSON.stringify({
					handle: "servo-100",
					message: "Bearer token confirmed.",
				}),
			}),
			env as never,
		);

		assert.equal(postResponse.status, 200);
		const postData = await readJson(postResponse);
		assert.equal(postData.success, true);
		assert.equal(postData.post.handle, "servo-100");
		assert.equal(postData.post.message, "Bearer token confirmed.");
	} finally {
		Math.random = originalMathRandom;
	}
});

test("message board returns the latest ten posts and paginates older ones", async () => {
	const originalMathRandom = Math.random;
	Math.random = () => 0;

	try {
		const env = createEnv();
		const startResponse = await handleChallengeStartRequest(
			createJsonRequest("https://robot.example/im-a-robot/api/challenge/start", {
				siteKey: "site_demo_123",
				hostname: "castrio.me",
				mode: "prove_robot",
			}),
			env as never,
		);
		const startData = await readJson(startResponse);

		const challengeSession = await loadChallengeSession(env as never, startData.sessionId);
		if (!challengeSession) {
			throw new Error("Expected challenge session to be stored");
		}

		const submitResponse = await handleChallengeSubmitRequest(
			createJsonRequest("https://robot.example/im-a-robot/api/challenge/submit", {
				sessionId: startData.sessionId,
				answer: getCorrectAnswerFromSession(challengeSession),
			}),
			env as never,
		);
		const submitData = await readJson(submitResponse);
		const resultToken = submitData.resultToken;
		assert.ok(typeof resultToken === "string");

		for (let index = 0; index < 12; index += 1) {
			const postResponse = await handleCreateMessageRequest(
				new Request("https://robot.example/im-a-robot/api/messages", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${resultToken}`,
					},
					body: JSON.stringify({
						handle: `servo-${index}`,
						message: `Message ${index}`,
					}),
				}),
				env as never,
			);
			assert.equal(postResponse.status, 200);
		}

		const firstPageResponse = await handleGetMessagesRequest(
			new Request("https://robot.example/im-a-robot/api/messages"),
			env as never,
		);
		assert.equal(firstPageResponse.status, 200);
		const firstPageData = await readJson(firstPageResponse);
		assert.equal(firstPageData.success, true);
		assert.equal(firstPageData.messages.length, 10);
		assert.equal(firstPageData.totalCount, 12);
		assert.equal(typeof firstPageData.nextCursor, "string");
		assert.ok(firstPageData.nextCursor);

		const secondPageResponse = await handleGetMessagesRequest(
			new Request(
				`https://robot.example/im-a-robot/api/messages?cursor=${encodeURIComponent(firstPageData.nextCursor)}`,
			),
			env as never,
		);
		assert.equal(secondPageResponse.status, 200);
		const secondPageData = await readJson(secondPageResponse);
		assert.equal(secondPageData.success, true);
		assert.equal(secondPageData.messages.length, 2);
		assert.equal(secondPageData.totalCount, 12);
		assert.equal(secondPageData.nextCursor, null);

		const allMessageIds = new Set(
			[...firstPageData.messages, ...secondPageData.messages].map((message: { id: string }) => message.id),
		);
		assert.equal(allMessageIds.size, 12);
	} finally {
		Math.random = originalMathRandom;
	}
});

test("message board rejects posts without a valid verification token", async () => {
	const env = createEnv();
	const response = await handleCreateMessageRequest(
		createJsonRequest("https://robot.example/im-a-robot/api/messages", {
			handle: "intruder",
			message: "Let me in.",
		}),
		env as never,
	);
	assert.equal(response.status, 401);
	const responseData = await readJson(response);
	assert.equal(responseData.success, false);
	assert.equal(responseData.error, "invalid_result_token");
});

test("message board rejects invalid bearer auth tokens", async () => {
	const env = createEnv();
	const response = await handleCreateMessageRequest(
		new Request("https://robot.example/im-a-robot/api/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer definitely-not-valid",
			},
			body: JSON.stringify({
				handle: "intruder",
				message: "Let me in.",
			}),
		}),
		env as never,
	);

	assert.equal(response.status, 401);
	const responseData = await readJson(response);
	assert.equal(responseData.success, false);
	assert.equal(responseData.error, "invalid_result_token");
});

test("message board preflight requests return the expected CORS headers", async () => {
	const env = createEnv();
	const response = await worker.fetch(
		new Request("https://robot.example/im-a-robot/api/messages", {
			method: "OPTIONS",
			headers: {
				Origin: "https://evil.example",
				"Access-Control-Request-Method": "POST",
				"Access-Control-Request-Headers": "authorization, content-type",
			},
		}),
		env as never,
	);

	assert.equal(response.status, 200);
	assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
	assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
	assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Authorization, Content-Type");
	assert.equal(response.headers.get("Access-Control-Max-Age"), "86400");
});

test("message board cross-origin unauthorized posts are rejected with CORS headers", async () => {
	const env = createEnv();
	const response = await worker.fetch(
		new Request("https://robot.example/im-a-robot/api/messages", {
			method: "POST",
			headers: {
				Origin: "https://evil.example",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				handle: "intruder",
				message: "Cross-origin attempt.",
			}),
		}),
		env as never,
	);

	assert.equal(response.status, 401);
	assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
	assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
	assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Authorization, Content-Type");
	assert.equal(response.headers.get("Access-Control-Max-Age"), "86400");

	const responseData = await readJson(response);
	assert.equal(responseData.success, false);
	assert.equal(responseData.error, "invalid_result_token");
});
