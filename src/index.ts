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

	const challengeDefinition = getRandomChallengeDefinition();
	const now = new Date();
	const startedChallenge = await challengeDefinition.start({ siteKey, hostname, now });
	const issuedAt = now.toISOString();
	const deadlineAt = new Date(now.getTime() + startedChallenge.timeLimitMs).toISOString();
	const sessionId = getRandomId("sess");
	const session = createPendingChallengeSession({
		sessionId,
		siteKey,
		hostname,
		challengeType: challengeDefinition.type,
		issuedAt,
		deadlineAt,
		promptPayload: startedChallenge.promptPayload,
		gradingKey: startedChallenge.gradingKey,
	});

	await saveChallengeSession(env, session);

	return createJsonResponse({
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

	if (session.status === "completed") {
		return createJsonErrorResponse("session_already_completed", 409);
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
	const tokenIssuedAtSeconds = Math.floor(submittedAt.getTime() / 1000);
	const tokenExpiresAtSeconds = tokenIssuedAtSeconds + RESULT_TOKEN_TTL_SECONDS;
	const tokenId = getRandomId("rtok");
	const completedSession = createCompletedChallengeSession({
		session,
		submittedAt,
		score: scoreResult.score,
		verdict: scoreResult.verdict,
		tokenId,
	});

	await saveChallengeSession(env, completedSession);

	if (scoreResult.verdict === "failed") {
		return createJsonResponse({
			success: false,
			verdict: "failed",
			reason: scoreResult.reason ?? "incorrect_answer",
			completedAt,
		});
	}

	const resultToken = await signResultToken(
		createResultTokenPayload({
			tokenId,
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
		verdict: scoreResult.verdict,
		score: scoreResult.score,
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

	const session = await loadChallengeSession(env, verifiedTokenPayload.sid);
	if (!session) {
		return createJsonErrorResponse("session_not_found", 404);
	}

	if (session.resultTokenId !== verifiedTokenPayload.tid) {
		return createJsonErrorResponse("invalid_result_token", 401);
	}

	return createJsonResponse({
		success: true,
		verdict: verifiedTokenPayload.verdict,
		challengeType: verifiedTokenPayload.ctype,
		score: verifiedTokenPayload.score,
		hostname: verifiedTokenPayload.host,
		issuedAt: session.issuedAt,
		completedAt: session.completedAt,
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

export async function saveChallengeSession(env: Env, session: ChallengeSession): Promise<void> {
	await env.SESSIONS.put(`session:${session.id}`, JSON.stringify(session), {
		expirationTtl: SESSION_TTL_SECONDS,
	});
}

export function getSigningSecret(env: Env): string | null {
	const signingSecret = env.SIGNING_SECRET?.trim() || env.DEV_SIGNING_SECRET?.trim();
	return signingSecret || null;
}

function createPendingChallengeSession(args: {
	sessionId: string;
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
	tokenId: string;
}): ChallengeSession {
	return {
		...args.session,
		status: args.submittedAt > new Date(args.session.deadlineAt) ? "expired" : "completed",
		completedAt: args.submittedAt.toISOString(),
		score: args.score,
		verdict: args.verdict,
		resultTokenId: args.tokenId,
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
