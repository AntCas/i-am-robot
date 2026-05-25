import {
	APP_BASE_PATH,
	RESULT_TOKEN_TTL_SECONDS,
	SESSION_TTL_SECONDS,
	challengeDefinitions,
	createResultTokenPayload,
	getChallengeDefinitionByType,
	getRandomChallengeDefinition,
	getRandomId,
} from "./challenges/index.ts";
import { getChallengeCatalog } from "./challenges/catalog.ts";
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
} from "./utils/http.ts";
import { signResultToken, verifyResultToken } from "./utils/token.ts";
import type {
	ChallengeSession,
	ChallengeGradingKey,
	ChallengePrompt,
	Env,
	MessageBoardPostPage,
	MessageBoardPost,
	MessageBoardPostVerification,
	MessageBoardPostRequestBody,
	ResultTokenPayload,
	SiteConfig,
	StartRequestBody,
	SubmitRequestBody,
	VerifyRequestBody,
	VerificationPolicy,
	VerificationMode,
	VerificationSession,
} from "./types.ts";

const DEFAULT_VERIFICATION_POLICY: VerificationPolicy = {
	requiredChallengesToPass: 1,
};
const DEFAULT_WIDGET_VERIFICATION_POLICY: VerificationPolicy = {
	requiredChallengesToPass: challengeDefinitions.length,
};
const DEFAULT_MESSAGE_BOARD_PAGE_SIZE = 10;
const MAX_MESSAGE_BOARD_PAGE_SIZE = 50;
const MESSAGE_BOARD_META_KEY = "message-board:meta";
const MESSAGE_BOARD_LEGACY_INDEX_KEY = "message-board:index";
const MESSAGE_BOARD_POST_KEY_PREFIX = "message-board:post:";
const MESSAGE_BOARD_REVERSE_TIMESTAMP_MAX = 9_999_999_999_999;

const API_DOCS_PATH = `${APP_BASE_PATH}/docs`;

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

			if (request.method === "GET" && isApiRequestPath(pathname, "/api/challenge/types")) {
				return handleChallengeTypesRequest(request);
			}

			if (request.method === "POST" && isApiRequestPath(pathname, "/api/challenge/submit")) {
				return await handleChallengeSubmitRequest(request, env);
			}

			if (request.method === "POST" && isApiRequestPath(pathname, "/api/verify")) {
				return await handleVerifyRequest(request, env);
			}

			if (request.method === "GET" && isApiRequestPath(pathname, "/api/messages")) {
				return await handleGetMessagesRequest(request, env);
			}

			if (request.method === "POST" && isApiRequestPath(pathname, "/api/messages")) {
				return await handleCreateMessageRequest(request, env);
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
	const requestedVerificationMode = requestBody.mode?.trim() ?? "prove_robot";
	const verificationSessionId = requestBody.verificationSessionId?.trim();
	const requestUrl = new URL(request.url);
	const hostname = normalizeHostnameInput(requestBody.hostname, request.headers.get("Origin"), requestUrl.host);

	if (!siteKey) {
		return createJsonErrorResponse("invalid_site_key", 400);
	}

	if (!isVerificationMode(requestedVerificationMode)) {
		return createJsonErrorResponse("invalid_mode", 400);
	}
	const verificationMode = requestedVerificationMode;

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
				mode: verificationMode,
				issuedAt: new Date().toISOString(),
				attemptNumber: normalizeAttemptNumber(requestBody.attemptNumber),
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
		mode: verificationMode,
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
		apiDocsUrl: createApiDocsUrl(requestUrl),
		sessionId,
		challenge: {
			type: challengeDefinition.type,
			prompt: startedChallenge.promptPayload,
		},
		issuedAt,
		deadlineAt,
	});
}

function createApiDocsUrl(requestUrl: URL): string {
	return new URL(API_DOCS_PATH, requestUrl.origin).toString();
}

export function handleChallengeTypesRequest(request: Request): Response {
	const requestUrl = new URL(request.url);
	return createJsonResponse({
		success: true,
		apiDocsUrl: createApiDocsUrl(requestUrl),
		challenges: getChallengeCatalog(),
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

export async function handleGetMessagesRequest(request: Request, env: Env): Promise<Response> {
	const requestUrl = new URL(request.url);
	const page = await loadMessageBoardPostPage(env, {
		limit: getMessageBoardPageSize(requestUrl.searchParams.get("limit")),
		cursor: normalizeMessageBoardCursor(requestUrl.searchParams.get("cursor")),
	});

	return createJsonResponse({
		success: true,
		messages: page.messages,
		totalCount: page.totalCount,
		nextCursor: page.nextCursor,
	});
}

export async function handleCreateMessageRequest(request: Request, env: Env): Promise<Response> {
	const requestBody = (await request.json()) as MessageBoardPostRequestBody;
	const resultToken = getMessageBoardAuthToken(request, requestBody);
	const message = requestBody.message?.trim();
	const requestedHandle = requestBody.handle?.trim();
	const signingSecret = getSigningSecret(env);

	if (!resultToken) {
		return createJsonErrorResponse("invalid_result_token", 401);
	}

	if (!message) {
		return createJsonErrorResponse("invalid_message", 400);
	}

	if (message.length > 280) {
		return createJsonErrorResponse("message_too_long", 400);
	}

	if (!signingSecret) {
		return createJsonErrorResponse("missing_signing_secret", 500);
	}

	const verifiedPostingContext = await loadVerifiedPostingContext(env, resultToken, signingSecret);
	if (!verifiedPostingContext) {
		return createJsonErrorResponse("invalid_result_token", 401);
	}

	const post: MessageBoardPost = {
		id: getRandomId("msg"),
		message,
		handle: normalizeMessageHandle(requestedHandle) ?? (await createAutomatedHandle(request)),
		postedAt: new Date().toISOString(),
		verification: createMessageBoardPostVerification(verifiedPostingContext.verificationSession),
	};

	await saveMessageBoardPost(env, post);

	return createJsonResponse({
		success: true,
		post,
	});
}

function getMessageBoardAuthToken(request: Request, requestBody: MessageBoardPostRequestBody): string | null {
	const authorizationHeader = request.headers.get("Authorization");
	const bearerToken = getBearerToken(authorizationHeader);

	if (bearerToken) {
		return bearerToken;
	}

	return requestBody.resultToken?.trim() || null;
}

function getBearerToken(authorizationHeader: string | null): string | null {
	if (!authorizationHeader) {
		return null;
	}

	const [scheme, ...tokenParts] = authorizationHeader.trim().split(/\s+/);
	if (scheme?.toLowerCase() !== "bearer" || tokenParts.length === 0) {
		return null;
	}

	const token = tokenParts.join(" ").trim();
	return token || null;
}

export async function loadSiteConfig(env: Env, siteKey: string): Promise<SiteConfig | null> {
	const siteFromKv = await env.SITES.get(`site:${siteKey}`, "json");
	const defaultSiteConfig = parseDefaultSiteConfig(env.DEFAULT_SITE_CONFIG);

	if (siteFromKv) {
		const siteConfig = siteFromKv as SiteConfig;
		if (!isValidSiteConfig(siteConfig)) {
			return null;
		}

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

export async function loadMessageBoardPostPage(
	env: Env,
	args: {
		limit?: number;
		cursor?: string;
	},
): Promise<MessageBoardPostPage> {
	const meta = await ensureMessageBoardMeta(env);
	const listedPosts = await env.SESSIONS.list({
		prefix: MESSAGE_BOARD_POST_KEY_PREFIX,
		limit: getMessageBoardPageSize(args.limit),
		cursor: args.cursor,
	});
	const storedMessages = await Promise.all(
		listedPosts.keys.map(async (key) => {
			const message = await env.SESSIONS.get(key.name, "json");
			return (message as MessageBoardPost | null) ?? null;
		}),
	);

	return {
		messages: storedMessages.filter((message): message is MessageBoardPost => Boolean(message)),
		totalCount: meta.totalCount,
		nextCursor: listedPosts.list_complete || !listedPosts.cursor ? null : listedPosts.cursor,
	};
}

export async function saveMessageBoardPost(env: Env, post: MessageBoardPost): Promise<void> {
	const meta = await ensureMessageBoardMeta(env);
	await env.SESSIONS.put(createMessageBoardPostStorageKey(post), JSON.stringify(post));
	await saveMessageBoardMeta(env, { totalCount: meta.totalCount + 1 });
}

async function ensureMessageBoardMeta(env: Env): Promise<{ totalCount: number }> {
	const storedMeta = await env.SESSIONS.get(MESSAGE_BOARD_META_KEY, "json");
	const normalizedMeta = normalizeMessageBoardMeta(storedMeta);
	if (normalizedMeta) {
		return normalizedMeta;
	}

	const legacyMessages = await loadLegacyMessageBoardPosts(env);
	if (legacyMessages.length > 0) {
		await Promise.all(
			legacyMessages.map((message) =>
				env.SESSIONS.put(createMessageBoardPostStorageKey(message), JSON.stringify(message)),
			),
		);

		const migratedMeta = { totalCount: legacyMessages.length };
		await saveMessageBoardMeta(env, migratedMeta);
		return migratedMeta;
	}

	const initializedMeta = {
		totalCount: await countStoredMessageBoardPosts(env),
	};
	await saveMessageBoardMeta(env, initializedMeta);
	return initializedMeta;
}

async function loadLegacyMessageBoardPosts(env: Env): Promise<MessageBoardPost[]> {
	const storedMessageIds = await env.SESSIONS.get(MESSAGE_BOARD_LEGACY_INDEX_KEY, "json");
	const messageIds = Array.isArray(storedMessageIds) ? storedMessageIds : [];
	const storedMessages = await Promise.all(
		messageIds.map(async (messageId) => {
			const message = await env.SESSIONS.get(`message-board:message:${messageId}`, "json");
			return (message as MessageBoardPost | null) ?? null;
		}),
	);

	return storedMessages.filter((message): message is MessageBoardPost => Boolean(message));
}

async function countStoredMessageBoardPosts(env: Env): Promise<number> {
	let totalCount = 0;
	let cursor: string | undefined;

	do {
		const listedPosts = await env.SESSIONS.list({
			prefix: MESSAGE_BOARD_POST_KEY_PREFIX,
			cursor,
			limit: MAX_MESSAGE_BOARD_PAGE_SIZE,
		});
		totalCount += listedPosts.keys.length;
		cursor = listedPosts.list_complete || !listedPosts.cursor ? undefined : listedPosts.cursor;
	} while (cursor);

	return totalCount;
}

async function saveMessageBoardMeta(env: Env, meta: { totalCount: number }): Promise<void> {
	await env.SESSIONS.put(MESSAGE_BOARD_META_KEY, JSON.stringify(meta));
}

function normalizeMessageBoardMeta(value: unknown): { totalCount: number } | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const totalCount = Reflect.get(value, "totalCount");
	if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
		return null;
	}

	return { totalCount };
}

function getMessageBoardPageSize(value: string | number | null | undefined): number {
	if (typeof value === "number") {
		if (Number.isSafeInteger(value) && value >= 1) {
			return Math.min(value, MAX_MESSAGE_BOARD_PAGE_SIZE);
		}

		return DEFAULT_MESSAGE_BOARD_PAGE_SIZE;
	}

	if (!value) {
		return DEFAULT_MESSAGE_BOARD_PAGE_SIZE;
	}

	const parsedValue = Number.parseInt(value, 10);
	if (!Number.isSafeInteger(parsedValue) || parsedValue < 1) {
		return DEFAULT_MESSAGE_BOARD_PAGE_SIZE;
	}

	return Math.min(parsedValue, MAX_MESSAGE_BOARD_PAGE_SIZE);
}

function normalizeMessageBoardCursor(value: string | null): string | undefined {
	const normalizedValue = value?.trim();
	return normalizedValue ? normalizedValue : undefined;
}

function createMessageBoardPostStorageKey(post: MessageBoardPost): string {
	const postedAtMilliseconds = Date.parse(post.postedAt);
	const normalizedPostedAtMilliseconds =
		Number.isFinite(postedAtMilliseconds) && postedAtMilliseconds >= 0
			? postedAtMilliseconds
			: Date.now();
	const reverseChronologicalTimestamp = String(
		MESSAGE_BOARD_REVERSE_TIMESTAMP_MAX - normalizedPostedAtMilliseconds,
	).padStart(String(MESSAGE_BOARD_REVERSE_TIMESTAMP_MAX).length, "0");

	return `${MESSAGE_BOARD_POST_KEY_PREFIX}${reverseChronologicalTimestamp}:${post.id}`;
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
	mode: VerificationMode;
	challengeType: ChallengeSession["challengeType"];
	issuedAt: string;
	deadlineAt: string;
	promptPayload: ChallengePrompt;
	gradingKey: ChallengeGradingKey;
}): ChallengeSession {
	return {
		id: args.sessionId,
		verificationSessionId: args.verificationSessionId,
		siteKey: args.siteKey,
		hostname: args.hostname,
		mode: args.mode,
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
	mode: VerificationMode;
	issuedAt: string;
	attemptNumber: number;
	requiredChallengesToPass: number;
}): VerificationSession {
	return {
		id: args.verificationSessionId,
		siteKey: args.siteKey,
		hostname: args.hostname,
		mode: args.mode,
		issuedAt: args.issuedAt,
		completedAt: null,
		status: "active",
		attemptNumber: args.attemptNumber,
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
	attemptNumber: number;
	status: VerificationSession["status"];
} {
	return {
		successfulChallenges: session.successfulChallenges,
		requiredChallengesToPass: session.requiredChallengesToPass,
		remainingChallenges: Math.max(0, session.requiredChallengesToPass - session.successfulChallenges),
		attemptNumber: getVerificationAttemptNumber(session),
		status: session.status,
	};
}

function resolveVerificationPolicy(args: {
	siteConfig: SiteConfig;
	hostname: string;
	mode: VerificationMode;
}): VerificationPolicy {
	if (args.mode === "widget") {
		return (
			args.siteConfig.widgetVerificationPolicy ??
			getDefaultVerificationPolicy(args.mode)
		);
	}

	return {
		requiredChallengesToPass:
			args.siteConfig.verificationPolicy?.requiredChallengesToPass ??
			getDefaultVerificationPolicy(args.mode).requiredChallengesToPass,
	};
}

function isVerificationMode(value: string): value is VerificationMode {
	return value === "prove_robot" || value === "widget";
}

function getDefaultVerificationPolicy(mode: VerificationMode): VerificationPolicy {
	return mode === "widget" ? DEFAULT_WIDGET_VERIFICATION_POLICY : DEFAULT_VERIFICATION_POLICY;
}

function mergeMatchingDefaultSiteConfig(siteConfig: SiteConfig, defaultSiteConfig: SiteConfig | null): SiteConfig {
	if (defaultSiteConfig?.siteKey !== siteConfig.siteKey) {
		return siteConfig;
	}

	return {
		...siteConfig,
		allowedHostnames: Array.from(new Set([...siteConfig.allowedHostnames, ...defaultSiteConfig.allowedHostnames])),
		verificationPolicy: siteConfig.verificationPolicy ?? defaultSiteConfig.verificationPolicy,
		widgetVerificationPolicy: siteConfig.widgetVerificationPolicy ?? defaultSiteConfig.widgetVerificationPolicy,
	};
}

function isValidSiteConfig(siteConfig: SiteConfig): boolean {
	return Boolean(
		siteConfig.siteKey &&
			siteConfig.secret &&
			Array.isArray(siteConfig.allowedHostnames) &&
			isValidVerificationPolicy(siteConfig.verificationPolicy) &&
			isValidVerificationPolicy(siteConfig.widgetVerificationPolicy),
	);
}

function isValidVerificationPolicy(verificationPolicy: VerificationPolicy | undefined): boolean {
	if (!verificationPolicy) {
		return true;
	}

	return (
		Number.isSafeInteger(verificationPolicy.requiredChallengesToPass) &&
		verificationPolicy.requiredChallengesToPass >= 1
	);
}

interface VerifiedPostingContext {
	verifiedTokenPayload: ResultTokenPayload;
	verificationSession: VerificationSession;
}

async function loadVerifiedPostingContext(
	env: Env,
	resultToken: string,
	signingSecret: string,
): Promise<VerifiedPostingContext | null> {
	const verifiedTokenPayload = await verifyResultToken(resultToken, signingSecret);
	if (!verifiedTokenPayload) {
		return null;
	}

	const verificationSession = await loadVerificationSession(env, verifiedTokenPayload.vid);
	if (!verificationSession) {
		return null;
	}

	if (
		verificationSession.status !== "completed" ||
		!verificationSession.completedAt ||
		verificationSession.resultTokenId !== verifiedTokenPayload.tid
	) {
		return null;
	}

	const session = await loadChallengeSession(env, verifiedTokenPayload.sid);
	if (!session) {
		return null;
	}

	if (
		session.resultTokenId !== verifiedTokenPayload.tid ||
		session.verificationSessionId !== verificationSession.id ||
		verificationSession.successfulChallenges < verificationSession.requiredChallengesToPass
	) {
		return null;
	}

	return {
		verifiedTokenPayload,
		verificationSession,
	};
}

function createMessageBoardPostVerification(session: VerificationSession): MessageBoardPostVerification {
	const issuedAtMs = new Date(session.issuedAt).getTime();
	const completedAtMs = new Date(session.completedAt ?? session.issuedAt).getTime();
	const durationMs = Number.isFinite(issuedAtMs) && Number.isFinite(completedAtMs)
		? Math.max(0, completedAtMs - issuedAtMs)
		: 0;

	return {
		source: session.mode === "widget" ? "widget_gui" : "api",
		mode: session.mode,
		verificationDurationMs: durationMs,
		successfulChallenges: session.successfulChallenges,
		requiredChallengesToPass: session.requiredChallengesToPass,
		attemptNumber: getVerificationAttemptNumber(session),
		issuedAt: session.issuedAt,
		completedAt: session.completedAt ?? session.issuedAt,
	};
}

function normalizeAttemptNumber(value: number | undefined): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : 1;
}

function getVerificationAttemptNumber(session: Pick<VerificationSession, "attemptNumber">): number {
	return normalizeAttemptNumber(session.attemptNumber);
}

function normalizeMessageHandle(value?: string): string | null {
	if (!value) {
		return null;
	}

	const normalizedHandle = value.replace(/\s+/g, " ").trim().slice(0, 40);
	return normalizedHandle || null;
}

async function createAutomatedHandle(request: Request): Promise<string> {
	const ipAddress = request.headers.get("CF-Connecting-IP")?.trim() || "unknown-ip";
	const userAgent = request.headers.get("User-Agent")?.trim() || "unknown-agent";
	const digestBytes = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ipAddress}|${userAgent}`)),
	);
	const fingerprint = Array.from(digestBytes.slice(0, 4), (value) => value.toString(16).padStart(2, "0")).join("");
	return `unit-${fingerprint}`;
}
