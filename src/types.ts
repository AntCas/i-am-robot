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
export type ChallengeType = "timed_math" | "randomness_audit" | "code_error" | "chess_puzzle";
export type ChallengeAnswerFormat = "integer" | "choice_id" | "san";

export interface SiteConfig {
	siteKey: string;
	secret: string;
	allowedHostnames: string[];
}

export interface VerificationPolicy {
	requiredChallengesToPass: number;
}

export interface ChallengeChoice {
	id: string;
	label: string;
	description?: string;
}

export interface ShortTextChallengePrompt {
	kind: "short_text";
	answerFormat: "integer";
	instruction: string;
	body: string;
	inputLabel: string;
	placeholder?: string;
	code?: string;
}

export interface MultipleChoiceChallengePrompt {
	kind: "multiple_choice";
	answerFormat: "choice_id";
	instruction: string;
	body?: string;
	code?: string;
	layout: "grid" | "list";
	choices: ChallengeChoice[];
}

export interface ChessPuzzleChallengePrompt {
	kind: "chess_puzzle";
	answerFormat: "san";
	instruction: string;
	body: string;
	inputLabel: string;
	fen: string;
	orientation: "white" | "black";
	placeholder?: string;
}

export type ChallengePrompt =
	| ShortTextChallengePrompt
	| MultipleChoiceChallengePrompt
	| ChessPuzzleChallengePrompt;

export interface IntegerChallengeGradingKey {
	answerFormat: "integer";
	expectedInteger: number;
}

export interface ChoiceChallengeGradingKey {
	answerFormat: "choice_id";
	expectedChoiceId: string;
}

export interface SanChallengeGradingKey {
	answerFormat: "san";
	expectedSan: string;
}

export type ChallengeGradingKey =
	| IntegerChallengeGradingKey
	| ChoiceChallengeGradingKey
	| SanChallengeGradingKey;

export interface IntegerChallengeAnswer {
	value: string;
}

export interface ChoiceChallengeAnswer {
	choiceId: string;
}

export type ChallengeAnswer = IntegerChallengeAnswer | ChoiceChallengeAnswer;

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
	promptPayload: ChallengePrompt;
	gradingKey: ChallengeGradingKey;
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
	promptPayload: ChallengePrompt;
	gradingKey: ChallengeGradingKey;
	timeLimitMs: number;
}

export interface ChallengeScoreContext {
	promptPayload: ChallengePrompt;
	gradingKey: ChallengeGradingKey;
	answer: ChallengeAnswer | undefined;
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
	answer?: ChallengeAnswer;
}

export interface VerifyRequestBody {
	secret?: string;
	resultToken?: string;
}

export interface MessageBoardPostRequestBody {
	message?: string;
	handle?: string;
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

export interface MessageBoardPost {
	id: string;
	message: string;
	handle: string;
	postedAt: string;
}
