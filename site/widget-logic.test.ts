import test from "node:test";
import assert from "node:assert/strict";

import { getAnswerForPrompt, getChallengeMarkup } from "./widget-logic.js";

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
	assert.match(markup, /position="6k1\/5ppp\/8\/8\/8\/8\/8\/R5K1 w - - 0 1"/);
	assert.match(markup, /FEN:/);
});
