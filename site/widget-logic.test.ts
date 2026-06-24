import test from "node:test";
import assert from "node:assert/strict";

import {
	createStartChallengeRequestBody,
	getCountdownPressureProgress,
	getAnswerForPrompt,
	getChallengeMarkup,
	getProgressSegmentStates,
	getWidgetMarkup,
	resolveWidgetConfig,
} from "./widget-logic.js";

test("getAnswerForPrompt returns a typed integer answer for short_text prompts", () => {
	const prompt = {
		kind: "short_text",
		answerFormat: "integer",
		instruction: "Solve it.",
		body: "What is 6 * 7?",
		inputLabel: "Answer",
	};

	const root = {
		querySelector(selector: string) {
			assert.equal(selector, "#widget-answer-input");
			return { value: "42" };
		},
	};

	assert.deepEqual(getAnswerForPrompt(root, prompt), { value: "42" });
});

test("getAnswerForPrompt returns a typed hash digest answer for short_text prompts", () => {
	const prompt = {
		kind: "short_text",
		answerFormat: "hex_digest",
		instruction: "Hash this value with SHA-256.",
		body: "Return the lowercase hexadecimal digest with no spaces.",
		inputLabel: "SHA-256 digest",
		code: "robot-check-42",
	};

	const root = {
		querySelector(selector: string) {
			assert.equal(selector, "#widget-answer-input");
			return { value: "D40804C883F92404BCB832B8F2A4DDD625F01E24D7649177CD39C5AD8021CB10" };
		},
	};

	assert.deepEqual(getAnswerForPrompt(root, prompt), {
		value: "D40804C883F92404BCB832B8F2A4DDD625F01E24D7649177CD39C5AD8021CB10",
	});
});

test("getAnswerForPrompt returns a typed choice answer for multiple_choice prompts", () => {
	const prompt = {
		kind: "multiple_choice",
		answerFormat: "choice_id",
		instruction: "Pick one.",
		layout: "list",
		choices: [{ id: "off_by_one", label: "Off by one" }],
	};

	const root = {
		querySelector(selector: string) {
			assert.equal(selector, 'input[name="widget-answer-choice"]:checked');
			return { value: "off_by_one" };
		},
	};

	assert.deepEqual(getAnswerForPrompt(root, prompt), { choiceId: "off_by_one" });
});

test("getAnswerForPrompt returns a typed SAN answer for chess prompts", () => {
	const prompt = {
		kind: "chess_puzzle",
		answerFormat: "san",
		instruction: "Find the best move.",
		body: "White to move.",
		inputLabel: "Best move",
		fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
		orientation: "white",
	};

	const root = {
		querySelector(selector: string) {
			assert.equal(selector, "#widget-answer-input");
			return { value: "Ra8#" };
		},
	};

	assert.deepEqual(getAnswerForPrompt(root, prompt), { value: "Ra8#" });
});

test("getAnswerForPrompt returns word search locations from the hidden locations input", () => {
	const prompt = {
		kind: "word_search",
		answerFormat: "word_locations",
		instruction: "Find words.",
		body: "Use coordinates.",
		grid: ["ROBOT"],
		words: ["ROBOT"],
		inputLabel: "Locations",
	};
	const locations = [{ word: "ROBOT", start: { row: 0, column: 0 }, end: { row: 0, column: 4 } }];
	const root = {
		querySelector(selector: string) {
			assert.equal(selector, "#widget-word-locations");
			return { value: JSON.stringify(locations) };
		},
	};

	assert.deepEqual(getAnswerForPrompt(root, prompt), { locations });
});

test("getAnswerForPrompt returns selected point-click coordinates", () => {
	const prompt = {
		kind: "point_click",
		answerFormat: "points",
		instruction: "Click ticks.",
		body: "Avoid seeds.",
		width: 640,
		height: 420,
		targetLabel: "tick",
		items: [],
	};
	const points = [{ x: 128, y: 96 }];
	const root = {
		querySelector(selector: string) {
			assert.equal(selector, "#widget-coordinate-points");
			return { value: JSON.stringify(points) };
		},
	};

	assert.deepEqual(getAnswerForPrompt(root, prompt), { points });
});

test("getAnswerForPrompt returns selected pixel grid coordinate", () => {
	const prompt = {
		kind: "pixel_grid",
		answerFormat: "grid_point",
		instruction: "Find the odd pixel.",
		body: "Use coordinates.",
		rows: 16,
		columns: 16,
		baseColor: "#2F7D32",
		targetColor: "#4F7942",
		targetColorLabel: "odd pixel",
		target: { row: 3, column: 7 },
	};
	const root = {
		querySelector(selector: string) {
			assert.equal(selector, "#widget-grid-point");
			return { value: JSON.stringify({ row: 3, column: 7 }) };
		},
	};

	assert.deepEqual(getAnswerForPrompt(root, prompt), { point: { row: 3, column: 7 } });
});

test("getChallengeMarkup renders choice descriptions for grid multiple choice prompts", () => {
	const markup = getChallengeMarkup({
		kind: "multiple_choice",
		answerFormat: "choice_id",
		instruction: "Pick the PRNG string.",
		body: "One string is machine-generated.",
		layout: "grid",
		choices: [{ id: "A", label: "A", description: "010101" }],
	});

	assert.match(markup, /Pick the PRNG string\./);
	assert.match(markup, /010101/);
	assert.match(markup, /choice-card/);
	assert.match(markup, /data-choice-id="A"/);
});

test("getChallengeMarkup renders hash short_text prompts with the value to hash", () => {
	const markup = getChallengeMarkup({
		kind: "short_text",
		answerFormat: "hex_digest",
		instruction: "Hash this value with SHA-256.",
		body: "Return the lowercase hexadecimal digest with no spaces.",
		inputLabel: "SHA-256 digest",
		code: "robot-check-42",
		placeholder: "lowercase hex digest",
	});

	assert.match(markup, /Hash this value with SHA-256\./);
	assert.match(markup, /robot-check-42/);
	assert.match(markup, /lowercase hex digest/);
});

test("getChallengeMarkup renders timed math prompts with expression metadata ignored by visible copy", () => {
	const markup = getChallengeMarkup({
		kind: "short_text",
		answerFormat: "integer",
		instruction: "Solve the expression.",
		body: "What is 17 * 23 + 9?",
		inputLabel: "Answer",
		mathExpressionParts: ["17", "*", "23", "+", "9"],
	});

	assert.match(markup, /Solve the expression\./);
	assert.match(markup, /What is 17 \* 23 \+ 9\?/);
	assert.doesNotMatch(markup, /mathExpressionParts/);
});

test("getChallengeMarkup renders a chess board and FEN for chess prompts", () => {
	const markup = getChallengeMarkup({
		kind: "chess_puzzle",
		answerFormat: "san",
		instruction: "Find the best next move in standard chess notation.",
		body: "White to move.",
		inputLabel: "Best move",
		fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
		orientation: "white",
		placeholder: "e.g. Qh7#",
	});

	assert.match(markup, /chess-board/);
	assert.match(markup, /position="6k1\/5ppp\/8\/8\/8\/8\/8\/R5K1"/);
	assert.match(markup, /FEN: <code>6k1\/5ppp\/8\/8\/8\/8\/8\/R5K1 w - - 0 1<\/code>/);
	assert.match(markup, /FEN:/);
	assert.match(markup, /data-role="chess-barb-stage"/);
});

test("getChallengeMarkup renders word search prompts", () => {
	const markup = getChallengeMarkup({
		kind: "word_search",
		answerFormat: "word_locations",
		instruction: "Find each target word.",
		body: "Coordinates are zero-based.",
		grid: ["ROBOT", "ABCDE"],
		words: ["ROBOT"],
		inputLabel: "Word locations",
		placeholder: "[]",
	});

	assert.match(markup, /word-search-grid/);
	assert.match(markup, /word-search-cell/);
	assert.match(markup, /robot-only-challenge-copy/);
	assert.match(markup, /Coordinates are zero-based\./);
	assert.match(markup, /id="widget-word-locations"/);
	assert.match(markup, /0\/1 found/);
	assert.doesNotMatch(markup, /textarea/);
});

test("getChallengeMarkup renders point-click and pixel-grid prompts", () => {
	const pointMarkup = getChallengeMarkup({
		kind: "point_click",
		answerFormat: "points",
		instruction: "Click every tick.",
		body: "Avoid seeds.",
		width: 640,
		height: 420,
		targetLabel: "tick",
		backgroundImageUrl: "/challenge-assets/lemon-poppy-seed-muffin.webp",
		items: [
			{
				id: "tick_1",
				kind: "tick",
				x: 128,
				y: 96,
				radius: 5,
				imageUrl: "/challenge-assets/tick.svg",
				rotationDegrees: 18,
			},
			{ id: "seed_1", kind: "seed", x: 220, y: 112, radius: 13, rotationDegrees: 74 },
		],
	});
	const pixelMarkup = getChallengeMarkup({
		kind: "pixel_grid",
		answerFormat: "grid_point",
		instruction: "Find the odd pixel.",
		body: "Use coordinates.",
		rows: 2,
		columns: 2,
		baseColor: "#2F7D32",
		targetColor: "#4F7942",
		targetColorLabel: "odd pixel",
		target: { row: 1, column: 0 },
	});

	assert.match(pointMarkup, /point-click-surface/);
	assert.match(pointMarkup, /lemon-poppy-seed-muffin\.webp/);
	assert.match(pointMarkup, /robot-only-challenge-copy/);
	assert.match(pointMarkup, /Avoid seeds\./);
	assert.match(pointMarkup, /point-item-tick/);
	assert.match(pointMarkup, /data-item-id="tick_1"/);
	assert.match(pointMarkup, /tick\.svg/);
	assert.match(pointMarkup, /--point-item-rotation: 18deg/);
	assert.match(pointMarkup, /point-item-seed/);
	assert.match(pixelMarkup, /pixel-grid/);
	assert.match(pixelMarkup, /robot-only-challenge-copy/);
	assert.match(pixelMarkup, /Use coordinates\./);
	assert.match(pixelMarkup, /Find the one pixel with color/);
	assert.match(pixelMarkup, /class="target-color-token" style="color: #4F7942;">#4F7942<\/code>/);
	assert.match(pixelMarkup, /background: #4F7942/);
});

test("getWidgetMarkup includes a low-profile api docs hint", () => {
	const markup = getWidgetMarkup({
		appBasePath: "/im-a-robot",
		siteKey: "site_demo_123",
		hostname: null,
		docsPath: "/im-a-robot/docs/",
		privacyPath: "/im-a-robot/privacy",
		termsPath: "/im-a-robot/terms",
	});

	assert.match(markup, /Robot operators:/);
	assert.match(markup, /href="\/im-a-robot\/docs\/"/);
	assert.match(markup, /direct verification without driving the browser widget/);
});

test("resolveWidgetConfig defaults docsPath from app base path", () => {
	const element = {
		getAttribute(name: string) {
			const attrs: Record<string, string | null> = {
				"app-base-path": "/im-a-robot",
				"site-key": "site_demo_123",
				hostname: null,
				"docs-path": null,
				"privacy-path": null,
				"terms-path": null,
			};

			return attrs[name] ?? null;
		},
	};

	assert.deepEqual(resolveWidgetConfig(element, "/im-a-robot/"), {
		appBasePath: "/im-a-robot",
		siteKey: "site_demo_123",
		hostname: null,
		demoChallenge: null,
		docsPath: "/im-a-robot/docs/",
		privacyPath: "/im-a-robot/privacy",
		termsPath: "/im-a-robot/terms",
	});
});

test("resolveWidgetConfig reads demo challenge from URL search params", () => {
	const element = {
		getAttribute(name: string) {
			const attrs: Record<string, string | null> = {
				"app-base-path": "/im-a-robot",
				"site-key": "site_demo_123",
				hostname: null,
				"demo-challenge": null,
				"docs-path": null,
				"privacy-path": null,
				"terms-path": null,
			};

			return attrs[name] ?? null;
		},
	};

	assert.equal(resolveWidgetConfig(element, "/im-a-robot/", "?challenge=spot_the_ticks").demoChallenge, "spot_the_ticks");
});

test("getProgressSegmentStates matches required challenge count", () => {
	assert.deepEqual(getProgressSegmentStates(0, 3), [false, false, false]);
	assert.deepEqual(getProgressSegmentStates(2, 3), [true, true, false]);
	assert.deepEqual(getProgressSegmentStates(1, 1), [true]);
});

test("getCountdownPressureProgress follows a subtle logarithmic ramp from the start", () => {
	const earlyProgress = getCountdownPressureProgress(9000, 10000);
	const midwayProgress = getCountdownPressureProgress(5000, 10000);
	const lateProgress = getCountdownPressureProgress(500, 10000);

	assert.equal(getCountdownPressureProgress(12000, 10000), 0);
	assert.ok(earlyProgress > 0);
	assert.ok(earlyProgress < 0.05);
	assert.ok(midwayProgress > earlyProgress);
	assert.ok(midwayProgress < 0.25);
	assert.ok(lateProgress > midwayProgress);
	assert.ok(lateProgress < 1);
	assert.equal(getCountdownPressureProgress(0, 10000), 1);
});

test("getCountdownPressureProgress remains smooth for short timers", () => {
	const earlyProgress = getCountdownPressureProgress(900, 1000);
	const lateProgress = getCountdownPressureProgress(250, 1000);

	assert.ok(earlyProgress > 0);
	assert.ok(earlyProgress < 0.05);
	assert.ok(lateProgress > earlyProgress);
});

test("createStartChallengeRequestBody identifies widget verification mode and attempt", () => {
	assert.deepEqual(createStartChallengeRequestBody("site_demo_123", "castrio.me", null, 2), {
		siteKey: "site_demo_123",
		hostname: "castrio.me",
		mode: "widget",
		verificationSessionId: null,
		attemptNumber: 2,
	});
});

test("createStartChallengeRequestBody includes demo challenge when supplied", () => {
	assert.deepEqual(createStartChallengeRequestBody("site_demo_123", "castrio.me", null, 1, "odd_color_pixel"), {
		siteKey: "site_demo_123",
		hostname: "castrio.me",
		mode: "widget",
		verificationSessionId: null,
		attemptNumber: 1,
		demoChallenge: "odd_color_pixel",
	});
});
