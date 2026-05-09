import test from "node:test";
import assert from "node:assert/strict";

import {
	handleChallengeStartRequest,
	handleChallengeSubmitRequest,
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

function createEnv() {
	return {
		SITES: new MemoryKVNamespace({
			"site:site_demo_123": JSON.stringify({
				siteKey: "site_demo_123",
				secret: "secret_demo_abc",
				allowedHostnames: ["castrio.me"],
			}),
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

test("verification requires three successful challenge submissions before issuing a token", async () => {
	const originalMathRandom = Math.random;
	Math.random = () => 0;

	try {
		const env = createEnv();
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
			assert.ok(startData.challenge?.prompt);
			assert.ok(typeof startData.challenge.prompt.answerFormat === "string");
			assert.ok(typeof startData.challenge.prompt.instruction === "string");

			const challengeSession = await loadChallengeSession(env as never, startData.sessionId);
			assert.ok(challengeSession);

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

test("chess puzzle grading accepts SAN without requiring mate punctuation", async () => {
	const startedChallenge = await chessPuzzleChallenge.start({
		siteKey: "site_demo_123",
		hostname: "castrio.me",
		now: new Date(),
	});

	const scoreResult = await chessPuzzleChallenge.score({
		promptPayload: startedChallenge.promptPayload,
		gradingKey: startedChallenge.gradingKey,
		answer: { value: startedChallenge.gradingKey.expectedSan.replace("#", "") },
		submittedAt: new Date(),
		deadlineAt: new Date(Date.now() + 5000),
	});

	assert.equal(scoreResult.score, 1);
	assert.equal(scoreResult.verdict, "robot");
});
