export interface Env {
	SITES: KVNamespace;
	SESSIONS: KVNamespace;
	ASSETS: Fetcher;
	SIGNING_SECRET: string;
	DEFAULT_SITE_CONFIG?: string;
	DEV_SIGNING_SECRET?: string;
}

export type Verdict = "robot" | "human" | "failed";
export type SessionStatus = "issued" | "completed" | "expired";
export type ChallengeType = "timed_math" | "randomness_audit" | "code_error";

export interface SiteConfig {
	siteKey: string;
	secret: string;
	allowedHostnames: string[];
}

export interface VerificationPolicy {
	requiredChallengesToPass: number;
}

export interface ChallengeSession {
	id: string;
	verificationSessionId: string;
	siteKey: string;
	hostname: string;
	mode: "prove_robot";
	challengeType: ChallengeType;
	issuedAt: string;
	deadlineAt: string;
	completedAt: string | null;
	status: SessionStatus;
	promptPayload: unknown;
	gradingKey: unknown;
	score: number | null;
	verdict: Verdict | null;
	resultTokenId: string | null;
}

export type VerificationSessionStatus = "active" | "completed" | "failed";

export interface VerificationSession {
	id: string;
	siteKey: string;
	hostname: string;
	mode: "prove_robot";
	issuedAt: string;
	completedAt: string | null;
	status: VerificationSessionStatus;
	requiredChallengesToPass: number;
	successfulChallenges: number;
	resultTokenId: string | null;
}

export interface ChallengeStartContext {
	siteKey: string;
	hostname: string;
	now: Date;
}

export interface ChallengeStartResult {
	promptPayload: unknown;
	gradingKey: unknown;
	timeLimitMs: number;
}

export interface ChallengeScoreContext {
	promptPayload: unknown;
	gradingKey: unknown;
	answer: unknown;
	submittedAt: Date;
	deadlineAt: Date;
}

export interface ChallengeScoreResult {
	score: number;
	verdict: Verdict;
	reason?: string;
}

export interface ChallengeDefinition {
	type: ChallengeType;
	start(ctx: ChallengeStartContext): Promise<ChallengeStartResult>;
	score(ctx: ChallengeScoreContext): Promise<ChallengeScoreResult>;
}

export interface StartRequestBody {
	siteKey?: string;
	hostname?: string;
	mode?: string;
	verificationSessionId?: string;
}

export interface SubmitRequestBody {
	sessionId?: string;
	answer?: unknown;
}

export interface VerifyRequestBody {
	secret?: string;
	resultToken?: string;
}

export interface ResultTokenPayload {
	tid: string;
	vid: string;
	sid: string;
	sk: string;
	host: string;
	ctype: ChallengeType;
	verdict: Verdict;
	score: number;
	iat: number;
	exp: number;
}
