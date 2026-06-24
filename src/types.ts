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
export type VerificationMode = "prove_robot" | "widget";
export type ChallengeType =
	| "timed_math"
	| "randomness_audit"
	| "code_error"
	| "chess_puzzle"
	| "hash_value"
	| "massive_word_search"
	| "spot_the_ticks"
	| "odd_color_pixel";
export type ChallengeAnswerFormat =
	| "integer"
	| "choice_id"
	| "san"
	| "hex_digest"
	| "word_locations"
	| "points"
	| "grid_point";

export interface SiteConfig {
	siteKey: string;
	secret: string;
	allowedHostnames: string[];
	verificationPolicy?: VerificationPolicy;
	widgetVerificationPolicy?: VerificationPolicy;
}

export interface SiteUsage {
	siteKey: string;
	requestCount: number;
	lastRequestAt: string | null;
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
	answerFormat: "integer" | "hex_digest";
	instruction: string;
	body: string;
	inputLabel: string;
	placeholder?: string;
	code?: string;
	hashFunction?: string;
	valueToHash?: string;
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

export interface GridCoordinate {
	row: number;
	column: number;
}

export interface WordSearchWordLocation {
	word: string;
	start: GridCoordinate;
	end: GridCoordinate;
}

export interface WordSearchChallengePrompt {
	kind: "word_search";
	answerFormat: "word_locations";
	instruction: string;
	body: string;
	grid: string[];
	words: string[];
	inputLabel: string;
	placeholder?: string;
}

export interface PointCoordinate {
	x: number;
	y: number;
}

export interface PointClickItem {
	id: string;
	kind: "tick" | "seed";
	x: number;
	y: number;
	radius: number;
	imageUrl?: string;
	rotationDegrees?: number;
}

export interface PointClickChallengePrompt {
	kind: "point_click";
	answerFormat: "points";
	instruction: string;
	body: string;
	width: number;
	height: number;
	targetLabel: string;
	backgroundImageUrl?: string;
	items: PointClickItem[];
}

export interface PixelGridChallengePrompt {
	kind: "pixel_grid";
	answerFormat: "grid_point";
	instruction: string;
	body: string;
	rows: number;
	columns: number;
	baseColor: string;
	targetColor: string;
	targetColorLabel: string;
	target: GridCoordinate;
}

export type ChallengePrompt =
	| ShortTextChallengePrompt
	| MultipleChoiceChallengePrompt
	| ChessPuzzleChallengePrompt
	| WordSearchChallengePrompt
	| PointClickChallengePrompt
	| PixelGridChallengePrompt;

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

export interface HexDigestChallengeGradingKey {
	answerFormat: "hex_digest";
	expectedHexDigest: string;
}

export interface WordLocationsChallengeGradingKey {
	answerFormat: "word_locations";
	expectedLocations: WordSearchWordLocation[];
}

export interface PointsChallengeGradingKey {
	answerFormat: "points";
	expectedPoints: PointCoordinate[];
	hitRadius: number;
}

export interface GridPointChallengeGradingKey {
	answerFormat: "grid_point";
	expectedPoint: GridCoordinate;
}

export type ChallengeGradingKey =
	| IntegerChallengeGradingKey
	| ChoiceChallengeGradingKey
	| SanChallengeGradingKey
	| HexDigestChallengeGradingKey
	| WordLocationsChallengeGradingKey
	| PointsChallengeGradingKey
	| GridPointChallengeGradingKey;

export type ChallengeGradingKeyForPrompt<TPrompt extends ChallengePrompt> = TPrompt extends ShortTextChallengePrompt
	? IntegerChallengeGradingKey | HexDigestChallengeGradingKey
	: TPrompt extends MultipleChoiceChallengePrompt
		? ChoiceChallengeGradingKey
		: TPrompt extends ChessPuzzleChallengePrompt
			? SanChallengeGradingKey
			: TPrompt extends WordSearchChallengePrompt
				? WordLocationsChallengeGradingKey
				: TPrompt extends PointClickChallengePrompt
					? PointsChallengeGradingKey
					: TPrompt extends PixelGridChallengePrompt
						? GridPointChallengeGradingKey
						: never;

export interface IntegerChallengeAnswer {
	value: string;
}

export interface ChoiceChallengeAnswer {
	choiceId: string;
}

export interface SanChallengeAnswer {
	value: string;
}

export interface HexDigestChallengeAnswer {
	value: string;
}

export interface WordLocationsChallengeAnswer {
	locations: WordSearchWordLocation[];
}

export interface PointsChallengeAnswer {
	points: PointCoordinate[];
}

export interface GridPointChallengeAnswer {
	point: GridCoordinate;
}

export type ChallengeAnswer =
	| IntegerChallengeAnswer
	| ChoiceChallengeAnswer
	| SanChallengeAnswer
	| HexDigestChallengeAnswer
	| WordLocationsChallengeAnswer
	| PointsChallengeAnswer
	| GridPointChallengeAnswer;

export type ChallengeAnswerForPrompt<TPrompt extends ChallengePrompt> = TPrompt extends ShortTextChallengePrompt
	? IntegerChallengeAnswer | HexDigestChallengeAnswer
	: TPrompt extends MultipleChoiceChallengePrompt
		? ChoiceChallengeAnswer
		: TPrompt extends ChessPuzzleChallengePrompt
			? SanChallengeAnswer
			: TPrompt extends WordSearchChallengePrompt
				? WordLocationsChallengeAnswer
				: TPrompt extends PointClickChallengePrompt
					? PointsChallengeAnswer
					: TPrompt extends PixelGridChallengePrompt
						? GridPointChallengeAnswer
						: never;

export interface ChallengeResponseFormat<TAnswer extends ChallengeAnswer = ChallengeAnswer> {
	description: string;
	answer: TAnswer;
}

export interface ChallengeCatalogExample<
	TPrompt extends ChallengePrompt = ChallengePrompt,
	TAnswer extends ChallengeAnswer = ChallengeAnswer,
> {
	prompt: TPrompt;
	answer: TAnswer;
}

export interface ChallengeCatalogMetadata<
	TPrompt extends ChallengePrompt = ChallengePrompt,
	TAnswer extends ChallengeAnswer = ChallengeAnswerForPrompt<TPrompt>,
> {
	responseFormat: ChallengeResponseFormat<TAnswer>;
	example: ChallengeCatalogExample<TPrompt, TAnswer>;
	timeLimitMs: number;
}

export interface ChallengeCatalogEntry<
	TType extends ChallengeType = ChallengeType,
	TPrompt extends ChallengePrompt = ChallengePrompt,
	TAnswer extends ChallengeAnswer = ChallengeAnswerForPrompt<TPrompt>,
> extends ChallengeCatalogMetadata<TPrompt, TAnswer> {
	type: TType;
	promptKind: TPrompt["kind"];
	answerFormat: TPrompt["answerFormat"];
}

export interface ChallengeSession {
	id: string;
	verificationSessionId: string;
	siteKey: string;
	hostname: string;
	mode: VerificationMode;
	isDemo?: boolean;
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
	mode: VerificationMode;
	isDemo?: boolean;
	issuedAt: string;
	completedAt: string | null;
	status: VerificationSessionStatus;
	attemptNumber: number;
	requiredChallengesToPass: number;
	successfulChallenges: number;
	resultTokenId: string | null;
}

export interface ChallengeStartContext {
	siteKey: string;
	hostname: string;
	now: Date;
}

export interface ChallengeStartResult<
	TPrompt extends ChallengePrompt = ChallengePrompt,
	TGradingKey extends ChallengeGradingKey = ChallengeGradingKeyForPrompt<TPrompt>,
> {
	promptPayload: TPrompt;
	gradingKey: TGradingKey;
	timeLimitMs: number;
}

export interface ChallengeScoreContext<
	TPrompt extends ChallengePrompt = ChallengePrompt,
	TGradingKey extends ChallengeGradingKey = ChallengeGradingKeyForPrompt<TPrompt>,
	TAnswer extends ChallengeAnswer = ChallengeAnswerForPrompt<TPrompt>,
> {
	promptPayload: TPrompt;
	gradingKey: TGradingKey;
	answer: TAnswer | undefined;
	submittedAt: Date;
	deadlineAt: Date;
}

export interface ChallengeScoreResult {
	score: number;
	verdict: Verdict;
	reason?: string;
	barb?: string;
}

export interface ChallengeDefinition<
	TType extends ChallengeType = ChallengeType,
	TPrompt extends ChallengePrompt = ChallengePrompt,
	TGradingKey extends ChallengeGradingKey = ChallengeGradingKeyForPrompt<TPrompt>,
	TAnswer extends ChallengeAnswer = ChallengeAnswerForPrompt<TPrompt>,
> {
	type: TType;
	catalog: ChallengeCatalogMetadata<TPrompt, TAnswer>;
	start(ctx: ChallengeStartContext): Promise<ChallengeStartResult<TPrompt, TGradingKey>>;
	score(ctx: ChallengeScoreContext<TPrompt, TGradingKey, TAnswer>): Promise<ChallengeScoreResult>;
}

export interface StartRequestBody {
	siteKey?: string;
	hostname?: string;
	mode?: string;
	verificationSessionId?: string;
	attemptNumber?: number;
	demoChallenge?: string;
}

export interface SubmitRequestBody {
	sessionId?: string;
	answer?: ChallengeAnswer;
}

export interface VerifyRequestBody {
	secret?: string;
	resultToken?: string;
}

export interface RegisterSiteRequestBody {
	hostname?: string;
}

export interface MessageBoardPostRequestBody {
	message?: string;
	handle?: string;
	resultToken?: string;
}

export type MessageBoardPostSource = "api" | "widget_gui";

export interface MessageBoardPostVerification {
	source: MessageBoardPostSource;
	mode: VerificationMode;
	verificationDurationMs: number;
	successfulChallenges: number;
	requiredChallengesToPass: number;
	attemptNumber: number;
	issuedAt: string;
	completedAt: string;
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
	verification: MessageBoardPostVerification;
}

export interface MessageBoardPostPage {
	messages: MessageBoardPost[];
	totalCount: number;
	nextCursor: string | null;
}
