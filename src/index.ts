import {
	APP_BASE_PATH,
	RESULT_TOKEN_TTL_SECONDS,
	SESSION_TTL_SECONDS,
	createResultTokenPayload,
	getChallengeDefinitionByType,
	getRandomChallengeDefinition,
	getRandomId,
} from "./challenges";
import {
	createJsonErrorResponse,
	createJsonResponse,
	createOptionsResponse,
	getStaticAssetPath,
	isApiRequestPath,
	isHealthRequestPath,
	isAllowedHostname,
	normalizeHostnameInput,
	normalizeRequestPathname,
} from "./utils/http";
import { signResultToken, verifyResultToken } from "./utils/token";
import type {
	ChallengeSession,
	Env,
	SiteConfig,
	StartRequestBody,
	SubmitRequestBody,
	VerifyRequestBody,
	VerificationPolicy,
	VerificationSession,
} from "./types";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const pathname = normalizeRequestPathname(new URL(request.url).pathname);

		if (request.method === "OPTIONS") {
			return createOptionsResponse();
		}

		try {
			if (request.method === "POST" && isApiRequestPath(pathname, "/api/challenge/start")) {
				return await handleChallengeStartRequest(request, env);
			}

			if (request.method === "POST" && isApiRequestPath(pathname, "/api/challenge/submit")) {
				return await handleChallengeSubmitRequest(request, env);
			}

			if (request.method === "POST" && isApiRequestPath(pathname, "/api/verify")) {
				return await handleVerifyRequest(request, env);
			}

			if (request.method === "GET" && isHealthRequestPath(pathname)) {
				return createJsonResponse({ ok: true }, 200);
			}

			if (request.method === "GET" || request.method === "HEAD") {
				return await serveStaticAssetResponse(request, env, pathname);
			}

			return createJsonErrorResponse("not_found", 404);
		} catch (error) {
			console.error(error);
			return createJsonErrorResponse("internal_error", 500);
		}
	},
};

export async function handleChallengeStartRequest(request: Request, env: Env): Promise<Response> {
	const requestBody = (await request.json()) as StartRequestBody;
	const siteKey = requestBody.siteKey?.trim();
	const verificationMode = requestBody.mode?.trim() ?? "prove_robot";
	const verificationSessionId = requestBody.verificationSessionId?.trim();
	const requestUrl = new URL(request.url);
	const hostname = normalizeHostnameInput(requestBody.hostname, request.headers.get("Origin"), requestUrl.host);

	if (!siteKey) {
		return createJsonErrorResponse("invalid_site_key", 400);
	}

	if (verificationMode !== "prove_robot") {
		return createJsonErrorResponse("invalid_mode", 400);
	}

	if (!hostname) {
		return createJsonErrorResponse("invalid_hostname", 400);
	}

	const siteConfig = await loadSiteConfig(env, siteKey);
	if (!siteConfig) {
		return createJsonErrorResponse("invalid_site_key", 404);
	}

	if (!isAllowedHostname(siteConfig.allowedHostnames, hostname)) {
		return createJsonErrorResponse("hostname_not_allowed", 403);
	}

	const verificationPolicy = resolveVerificationPolicy({
		siteConfig,
		hostname,
		mode: verificationMode,
	});

	const verificationSession = verificationSessionId
		? await loadVerificationSession(env, verificationSessionId)
		: createActiveVerificationSession({
				verificationSessionId: getRandomId("vfy"),
				siteKey,
				hostname,
				issuedAt: new Date().toISOString(),
				requiredChallengesToPass: verificationPolicy.requiredChallengesToPass,
			});

	if (!verificationSession) {
		return createJsonErrorResponse("verification_session_not_found", 404);
	}

	if (
		verificationSession.siteKey !== siteKey ||
		verificationSession.hostname !== hostname ||
		verificationSession.mode !== verificationMode
	) {
		return createJsonErrorResponse("invalid_verification_session", 409);
	}

	if (verificationSession.status !== "active") {
		return createJsonErrorResponse("verification_session_closed", 409);
	}

	const challengeDefinition = getRandomChallengeDefinition();
	const now = new Date();
	const startedChallenge = await challengeDefinition.start({ siteKey, hostname, now });
	const issuedAt = now.toISOString();
	const deadlineAt = new Date(now.getTime() + startedChallenge.timeLimitMs).toISOString();
	const sessionId = getRandomId("sess");
	const session = createPendingChallengeSession({
		sessionId,
		verificationSessionId: verificationSession.id,
		siteKey,
		hostname,
		challengeType: challengeDefinition.type,
		issuedAt,
		deadlineAt,
		promptPayload: startedChallenge.promptPayload,
		gradingKey: startedChallenge.gradingKey,
	});

	await saveVerificationSession(env, verificationSession);
	await saveChallengeSession(env, session);

	return createJsonResponse({
		verificationSessionId: verificationSession.id,
		verification: createVerificationProgressPayload(verificationSession),
		sessionId,
		challenge: {
			type: challengeDefinition.type,
			prompt: startedChallenge.promptPayload,
		},
		issuedAt,
		deadlineAt,
	});
}

export async function handleChallengeSubmitRequest(request: Request, env: Env): Promise<Response> {
	const requestBody = (await request.json()) as SubmitRequestBody;
	const sessionId = requestBody.sessionId?.trim();
	const signingSecret = getSigningSecret(env);

	if (!sessionId) {
		return createJsonErrorResponse("session_not_found", 400);
	}

	if (!signingSecret) {
		return createJsonErrorResponse("missing_signing_secret", 500);
	}

	const session = await loadChallengeSession(env, sessionId);
	if (!session) {
		return createJsonErrorResponse("session_not_found", 404);
	}

	if (session.status !== "issued") {
		return createJsonErrorResponse("session_already_completed", 409);
	}

	const verificationSession = await loadVerificationSession(env, session.verificationSessionId);
	if (!verificationSession) {
		return createJsonErrorResponse("verification_session_not_found", 404);
	}

	if (verificationSession.status !== "active") {
		return createJsonErrorResponse("verification_session_closed", 409);
	}

	const submittedAt = new Date();
	const deadlineAt = new Date(session.deadlineAt);
	const challengeDefinition = getChallengeDefinitionByType(session.challengeType);
	const scoreResult = await challengeDefinition.score({
		promptPayload: session.promptPayload,
		gradingKey: session.gradingKey,
		answer: requestBody.answer,
		submittedAt,
		deadlineAt,
	});
	const completedAt = submittedAt.toISOString();
	const completedSession = createCompletedChallengeSession({
		session,
		submittedAt,
		score: scoreResult.score,
		verdict: scoreResult.verdict,
	});

	await saveChallengeSession(env, completedSession);

	if (scoreResult.verdict === "failed") {
		const failedVerificationSession = createFailedVerificationSession(verificationSession, completedAt);
		await saveVerificationSession(env, failedVerificationSession);

		return createJsonResponse({
			success: false,
			verdict: "failed",
			reason: scoreResult.reason ?? "incorrect_answer",
			completedAt,
			verificationSessionId: verificationSession.id,
			verification: createVerificationProgressPayload(failedVerificationSession),
		});
	}

	const successfulChallenges = verificationSession.successfulChallenges + 1;
	if (successfulChallenges < verificationSession.requiredChallengesToPass) {
		const advancedVerificationSession = {
			...verificationSession,
			successfulChallenges,
		};
		await saveVerificationSession(env, advancedVerificationSession);

		return createJsonResponse({
			success: true,
			verified: false,
			verdict: scoreResult.verdict,
			score: scoreResult.score,
			completedAt,
			verificationSessionId: verificationSession.id,
			verification: createVerificationProgressPayload(advancedVerificationSession),
		});
	}

	const tokenIssuedAtSeconds = Math.floor(submittedAt.getTime() / 1000);
	const tokenExpiresAtSeconds = tokenIssuedAtSeconds + RESULT_TOKEN_TTL_SECONDS;
	const tokenId = getRandomId("rtok");
	const finalizedSession = {
		...completedSession,
		resultTokenId: tokenId,
	};
	const completedVerificationSession = createCompletedVerificationSession({
		session: verificationSession,
		completedAt,
		successfulChallenges,
		tokenId,
	});

	await saveChallengeSession(env, finalizedSession);
	await saveVerificationSession(env, completedVerificationSession);

	const resultToken = await signResultToken(
		createResultTokenPayload({
			tokenId,
			verificationSessionId: verificationSession.id,
			sessionId: session.id,
			siteKey: session.siteKey,
			hostname: session.hostname,
			challengeType: session.challengeType,
			verdict: scoreResult.verdict,
			score: scoreResult.score,
			issuedAtSeconds: tokenIssuedAtSeconds,
			expiresAtSeconds: tokenExpiresAtSeconds,
		}),
		signingSecret,
	);

	return createJsonResponse({
		success: true,
		verified: true,
		verdict: scoreResult.verdict,
		score: scoreResult.score,
		verificationSessionId: verificationSession.id,
		verification: createVerificationProgressPayload(completedVerificationSession),
		resultToken,
		completedAt,
		expiresAt: new Date(tokenExpiresAtSeconds * 1000).toISOString(),
	});
}

export async function handleVerifyRequest(request: Request, env: Env): Promise<Response> {
	const requestBody = (await request.json()) as VerifyRequestBody;
	const secret = requestBody.secret?.trim();
	const resultToken = requestBody.resultToken?.trim();
	const signingSecret = getSigningSecret(env);

	if (!secret) {
		return createJsonErrorResponse("invalid_secret", 400);
	}

	if (!resultToken) {
		return createJsonErrorResponse("invalid_result_token", 400);
	}

	if (!signingSecret) {
		return createJsonErrorResponse("missing_signing_secret", 500);
	}

	const verifiedTokenPayload = await verifyResultToken(resultToken, signingSecret);
	if (!verifiedTokenPayload) {
		return createJsonErrorResponse("invalid_result_token", 401);
	}

	const siteConfig = await loadSiteConfig(env, verifiedTokenPayload.sk);
	if (!siteConfig || siteConfig.secret !== secret) {
		return createJsonErrorResponse("invalid_secret", 401);
	}

	const verificationSession = await loadVerificationSession(env, verifiedTokenPayload.vid);
	if (!verificationSession) {
		return createJsonErrorResponse("verification_session_not_found", 404);
	}

	if (verificationSession.status !== "completed" || verificationSession.resultTokenId !== verifiedTokenPayload.tid) {
		return createJsonErrorResponse("invalid_result_token", 401);
	}

	const session = await loadChallengeSession(env, verifiedTokenPayload.sid);
	if (!session) {
		return createJsonErrorResponse("session_not_found", 404);
	}

	if (
		session.resultTokenId !== verifiedTokenPayload.tid ||
		session.verificationSessionId !== verificationSession.id ||
		verificationSession.successfulChallenges < verificationSession.requiredChallengesToPass
	) {
		return createJsonErrorResponse("invalid_result_token", 401);
	}

	return createJsonResponse({
		success: true,
		verdict: verifiedTokenPayload.verdict,
		challengeType: verifiedTokenPayload.ctype,
		score: verifiedTokenPayload.score,
		hostname: verifiedTokenPayload.host,
		issuedAt: verificationSession.issuedAt,
		completedAt: verificationSession.completedAt,
	});
}

export async function loadSiteConfig(env: Env, siteKey: string): Promise<SiteConfig | null> {
	const siteFromKv = await env.SITES.get(`site:${siteKey}`, "json");
	const defaultSiteConfig = parseDefaultSiteConfig(env.DEFAULT_SITE_CONFIG);

	if (siteFromKv) {
		const siteConfig = siteFromKv as SiteConfig;
		return mergeMatchingDefaultSiteConfig(siteConfig, defaultSiteConfig);
	}

	if (defaultSiteConfig?.siteKey === siteKey) {
		return defaultSiteConfig;
	}

	return null;
}

export function parseDefaultSiteConfig(rawDefaultSiteConfig?: string): SiteConfig | null {
	if (!rawDefaultSiteConfig) {
		return null;
	}

	try {
		const parsedSiteConfig = JSON.parse(rawDefaultSiteConfig) as SiteConfig;
		if (isValidSiteConfig(parsedSiteConfig)) {
			return parsedSiteConfig;
		}
	} catch (error) {
		console.error("Failed to parse DEFAULT_SITE_CONFIG", error);
	}

	return null;
}

export async function serveStaticAssetResponse(request: Request, env: Env, pathname: string): Promise<Response> {
	const assetPath = getStaticAssetPath(pathname);
	if (!assetPath) {
		return createJsonErrorResponse("not_found", 404);
	}

	const requestUrl = new URL(request.url);
	const assetUrl = new URL(assetPath, requestUrl.origin);
	return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
}

export async function loadChallengeSession(env: Env, sessionId: string): Promise<ChallengeSession | null> {
	const session = await env.SESSIONS.get(`session:${sessionId}`, "json");
	return (session as ChallengeSession | null) ?? null;
}

export async function loadVerificationSession(env: Env, verificationSessionId: string): Promise<VerificationSession | null> {
	const session = await env.SESSIONS.get(`verification:${verificationSessionId}`, "json");
	return (session as VerificationSession | null) ?? null;
}

export async function saveChallengeSession(env: Env, session: ChallengeSession): Promise<void> {
	await env.SESSIONS.put(`session:${session.id}`, JSON.stringify(session), {
		expirationTtl: SESSION_TTL_SECONDS,
	});
}

export async function saveVerificationSession(env: Env, session: VerificationSession): Promise<void> {
	await env.SESSIONS.put(`verification:${session.id}`, JSON.stringify(session), {
		expirationTtl: SESSION_TTL_SECONDS,
	});
}

export function getSigningSecret(env: Env): string | null {
	const signingSecret = env.SIGNING_SECRET?.trim() || env.DEV_SIGNING_SECRET?.trim();
	return signingSecret || null;
}

function createPendingChallengeSession(args: {
	sessionId: string;
	verificationSessionId: string;
	siteKey: string;
	hostname: string;
	challengeType: ChallengeSession["challengeType"];
	issuedAt: string;
	deadlineAt: string;
	promptPayload: unknown;
	gradingKey: unknown;
}): ChallengeSession {
	return {
		id: args.sessionId,
		verificationSessionId: args.verificationSessionId,
		siteKey: args.siteKey,
		hostname: args.hostname,
		mode: "prove_robot",
		challengeType: args.challengeType,
		issuedAt: args.issuedAt,
		deadlineAt: args.deadlineAt,
		completedAt: null,
		status: "issued",
		promptPayload: args.promptPayload,
		gradingKey: args.gradingKey,
		score: null,
		verdict: null,
		resultTokenId: null,
	};
}

function createCompletedChallengeSession(args: {
	session: ChallengeSession;
	submittedAt: Date;
	score: number;
	verdict: ChallengeSession["verdict"];
}): ChallengeSession {
	return {
		...args.session,
		status: args.submittedAt > new Date(args.session.deadlineAt) ? "expired" : "completed",
		completedAt: args.submittedAt.toISOString(),
		score: args.score,
		verdict: args.verdict,
		resultTokenId: null,
	};
}

function createActiveVerificationSession(args: {
	verificationSessionId: string;
	siteKey: string;
	hostname: string;
	issuedAt: string;
	requiredChallengesToPass: number;
}): VerificationSession {
	return {
		id: args.verificationSessionId,
		siteKey: args.siteKey,
		hostname: args.hostname,
		mode: "prove_robot",
		issuedAt: args.issuedAt,
		completedAt: null,
		status: "active",
		requiredChallengesToPass: args.requiredChallengesToPass,
		successfulChallenges: 0,
		resultTokenId: null,
	};
}

function createCompletedVerificationSession(args: {
	session: VerificationSession;
	completedAt: string;
	successfulChallenges: number;
	tokenId: string;
}): VerificationSession {
	return {
		...args.session,
		completedAt: args.completedAt,
		status: "completed",
		successfulChallenges: args.successfulChallenges,
		resultTokenId: args.tokenId,
	};
}

function createFailedVerificationSession(session: VerificationSession, completedAt: string): VerificationSession {
	return {
		...session,
		completedAt,
		status: "failed",
		resultTokenId: null,
	};
}

function createVerificationProgressPayload(session: VerificationSession): {
	successfulChallenges: number;
	requiredChallengesToPass: number;
	remainingChallenges: number;
	status: VerificationSession["status"];
} {
	return {
		successfulChallenges: session.successfulChallenges,
		requiredChallengesToPass: session.requiredChallengesToPass,
		remainingChallenges: Math.max(0, session.requiredChallengesToPass - session.successfulChallenges),
		status: session.status,
	};
}

function resolveVerificationPolicy(args: {
	siteConfig: SiteConfig;
	hostname: string;
	mode: "prove_robot";
}): VerificationPolicy {
	return {
		requiredChallengesToPass: 3,
	};
}

function mergeMatchingDefaultSiteConfig(siteConfig: SiteConfig, defaultSiteConfig: SiteConfig | null): SiteConfig {
	if (defaultSiteConfig?.siteKey !== siteConfig.siteKey) {
		return siteConfig;
	}

	return {
		...siteConfig,
		allowedHostnames: Array.from(new Set([...siteConfig.allowedHostnames, ...defaultSiteConfig.allowedHostnames])),
	};
}

function isValidSiteConfig(siteConfig: SiteConfig): boolean {
	return Boolean(siteConfig.siteKey && siteConfig.secret && Array.isArray(siteConfig.allowedHostnames));
}
