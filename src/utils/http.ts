import { APP_BASE_PATH, API_PATH_PREFIX } from "../challenges/index.ts";

// This module keeps request/response helpers pure and easy to test.

const responseCorsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Authorization, Content-Type",
	"Access-Control-Max-Age": "86400",
};

export function createOptionsResponse(): Response {
	return new Response(null, { headers: responseCorsHeaders });
}

export function createJsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			...responseCorsHeaders,
		},
	});
}

export function createJsonErrorResponse(code: string, status: number): Response {
	return createJsonResponse({ success: false, error: code }, status);
}

export function normalizeRequestPathname(pathname: string): string {
	if (pathname.length > 1 && pathname.endsWith("/")) {
		return pathname.slice(0, -1);
	}

	return pathname || "/";
}

export function isApiRequestPath(pathname: string, suffix: string): boolean {
	return pathname === suffix || pathname === `${API_PATH_PREFIX}${suffix.slice(4)}`;
}

export function isHealthRequestPath(pathname: string): boolean {
	return pathname === "/health" || pathname === `${APP_BASE_PATH}/health`;
}

export function getStaticAssetPath(pathname: string): string | null {
	if (pathname === APP_BASE_PATH || pathname === `${APP_BASE_PATH}/`) {
		return "/index.html";
	}

	if (pathname === `${APP_BASE_PATH}/embed` || pathname === `${APP_BASE_PATH}/embed/`) {
		return "/embed/index.html";
	}

	if (pathname === `${APP_BASE_PATH}/privacy` || pathname === `${APP_BASE_PATH}/privacy/`) {
		return "/privacy/index.html";
	}

	if (pathname === `${APP_BASE_PATH}/terms` || pathname === `${APP_BASE_PATH}/terms/`) {
		return "/terms/index.html";
	}

	if (pathname === `${APP_BASE_PATH}/docs` || pathname === `${APP_BASE_PATH}/docs/`) {
		return "/docs/index.html";
	}

	if (pathname.startsWith(`${APP_BASE_PATH}/`)) {
		return pathname.slice(APP_BASE_PATH.length);
	}

	if (pathname === "/" || pathname === "/index.html") {
		return "/index.html";
	}

	if (pathname.startsWith("/")) {
		return pathname;
	}

	return null;
}

export function normalizeHostnameInput(hostname?: string, origin?: string | null, fallbackHost?: string | null): string | null {
	if (hostname) {
		return getSafeHostname(hostname);
	}

	if (origin) {
		try {
			return new URL(origin).host;
		} catch {
			return null;
		}
	}

	return fallbackHost ?? null;
}

export function isAllowedHostname(allowedHostnames: string[], hostname: string): boolean {
	if (allowedHostnames.includes(hostname)) {
		return true;
	}

	if (isLoopbackHostname(hostname)) {
		return allowedHostnames.some((candidate) => isLoopbackHostname(candidate) && doHostsSharePort(candidate, hostname));
	}

	return false;
}

function getSafeHostname(value: string): string | null {
	try {
		if (value.includes("://")) {
			return new URL(value).host;
		}

		return new URL(`https://${value}`).host;
	} catch {
		return null;
	}
}

function isLoopbackHostname(value: string): boolean {
	const { host } = splitHostAndPort(value);
	return host === "localhost" || host === "127.0.0.1";
}

function doHostsSharePort(left: string, right: string): boolean {
	return splitHostAndPort(left).port === splitHostAndPort(right).port;
}

function splitHostAndPort(value: string): { host: string; port: string } {
	const parts = value.split(":");

	if (parts.length === 1) {
		return { host: value, port: "" };
	}

	const port = parts.pop() ?? "";
	return { host: parts.join(":"), port };
}
