import type { ResultTokenPayload } from "../types.ts";

const TOKEN_HEADER = { alg: "HS256", typ: "RBT" };

// Token helpers stay isolated here so signing and verification can be
// tested without exercising the request handlers.

export async function signResultToken(payload: ResultTokenPayload, secret: string): Promise<string> {
	const encodedHeader = encodeBase64Url(JSON.stringify(TOKEN_HEADER));
	const encodedPayload = encodeBase64Url(JSON.stringify(payload));
	const unsignedToken = `${encodedHeader}.${encodedPayload}`;
	const signature = await createHmacSignature(unsignedToken, secret);
	return `${unsignedToken}.${signature}`;
}

export async function verifyResultToken(token: string, secret: string): Promise<ResultTokenPayload | null> {
	const tokenParts = token.split(".");

	if (tokenParts.length !== 3) {
		return null;
	}

	const [encodedHeader, encodedPayload, providedSignature] = tokenParts;
	const unsignedToken = `${encodedHeader}.${encodedPayload}`;
	const expectedSignature = await createHmacSignature(unsignedToken, secret);

	if (!isTimingSafeMatch(providedSignature, expectedSignature)) {
		return null;
	}

	try {
		const payload = JSON.parse(decodeBase64Url(encodedPayload)) as ResultTokenPayload;
		if (isExpiredTokenPayload(payload)) {
			return null;
		}

		return payload;
	} catch {
		return null;
	}
}

function isExpiredTokenPayload(payload: ResultTokenPayload): boolean {
	const currentUnixTimestamp = Math.floor(Date.now() / 1000);
	return payload.exp < currentUnixTimestamp;
}

async function createHmacSignature(value: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{
			name: "HMAC",
			hash: "SHA-256",
		},
		false,
		["sign"],
	);

	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
	return encodeBytesBase64Url(new Uint8Array(signature));
}

function encodeBase64Url(value: string): string {
	return encodeBytesBase64Url(new TextEncoder().encode(value));
}

function encodeBytesBase64Url(bytes: Uint8Array): string {
	let binary = "";

	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
	return atob(padded);
}

function isTimingSafeMatch(left: string, right: string): boolean {
	if (left.length !== right.length) {
		return false;
	}

	let difference = 0;

	for (let index = 0; index < left.length; index += 1) {
		difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
	}

	return difference === 0;
}
