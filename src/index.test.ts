import test from "node:test";
import assert from "node:assert/strict";

import {
	handleChallengeStartRequest,
	handleChallengeSubmitRequest,
	handleCreateMessageRequest,
	handleGetMessagesRequest,
	handleVerifyRequest,
	loadChallengeSession,
} from "./index.ts";
import { chessPuzzleChallenge } from "./challenges/_chess-puzzle.ts";

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
}

function createEnv({ requiredChallengesToPass }: { requiredChallengesToPass?: number } = {}) {
	const siteConfig: Record<string, unknown> = {
		siteKey: "site_demo_123",
		secret: "secret_demo_abc",
		allowedHostnames: ["castrio.me"],
	};

	if (requiredChallengesToPass !== undefined) {
		siteConfig.verificationPolicy = { requiredChallengesToPass };
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

	return { choiceId: session.gradingKey.expectedChoiceId };
}

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

		const listResponse = await handleGetMessagesRequest(env as never);
		assert.equal(listResponse.status, 200);
		const listData = await readJson(listResponse);
		assert.equal(listData.success, true);
		assert.equal(listData.messages.length, 1);
		assert.equal(listData.messages[0].handle, "servo-99");
		assert.equal(listData.messages[0].message, "Beep boop. Systems nominal.");
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
