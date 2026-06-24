const EMBED_SOURCE = "robot-check-embed";
const EMBED_READY_EVENT = "robot-check-ready";
const EMBED_RESIZE_EVENT = "robot-check-resize";
const VERIFICATION_PASSED_EVENT = "robot-verification-passed";
const DEFAULT_SITE_KEY = "site_demo_123";
const DEFAULT_MIN_HEIGHT = 188;
const APP_BASE_PATH = "/im-a-robot";

const searchParams = new URLSearchParams(window.location.search);
const referrerUrl = parseUrl(document.referrer);
const embedId = normalizeEmbedId(searchParams.get("embedId")) ?? "robot-check-embed";
const siteKey = normalizeString(searchParams.get("siteKey")) ?? DEFAULT_SITE_KEY;
const parentOrigin = normalizeOrigin(searchParams.get("parentOrigin")) ?? referrerUrl?.origin ?? "*";
const hostname = normalizeHostname(searchParams.get("hostname")) ?? referrerUrl?.host ?? window.location.host;
const demoChallenge = normalizeChallengeName(searchParams.get("challenge"));
const rootElement = document.querySelector('[data-role="embed-root"]');

if (rootElement) {
  mountEmbed(rootElement);
}

function mountEmbed(root) {
  const widgetElement = document.createElement("robot-check-widget");
  widgetElement.setAttribute("site-key", siteKey);
  widgetElement.setAttribute("app-base-path", APP_BASE_PATH);

  if (hostname) {
    widgetElement.setAttribute("hostname", hostname);
  }

  if (demoChallenge) {
    widgetElement.setAttribute("demo-challenge", demoChallenge);
  }

  applyOptionalPath(widgetElement, "docs-path", searchParams.get("docsPath"));
  applyOptionalPath(widgetElement, "privacy-path", searchParams.get("privacyPath"));
  applyOptionalPath(widgetElement, "terms-path", searchParams.get("termsPath"));

  root.replaceChildren(widgetElement);
  openWidgetLinksInNewTab(root);

  widgetElement.addEventListener(VERIFICATION_PASSED_EVENT, (event) => {
    postEmbedMessage({
      type: VERIFICATION_PASSED_EVENT,
      detail: {
        ...event.detail,
        siteKey,
        hostname,
      },
    });
  });

  const resizeObserver = new ResizeObserver(() => {
    postMeasuredHeight();
  });
  resizeObserver.observe(document.body);
  resizeObserver.observe(document.documentElement);
  resizeObserver.observe(root);

  window.addEventListener("load", () => {
    postEmbedMessage({ type: EMBED_READY_EVENT });
    postMeasuredHeight();
  }, { once: true });
  window.addEventListener("resize", postMeasuredHeight);

  postEmbedMessage({ type: EMBED_READY_EVENT });
  postMeasuredHeight();
}

function applyOptionalPath(element, attributeName, value) {
  const normalizedPath = normalizeRelativePath(value);
  if (normalizedPath) {
    element.setAttribute(attributeName, normalizedPath);
  }
}

function openWidgetLinksInNewTab(root) {
  root.querySelectorAll("a").forEach((linkElement) => {
    linkElement.setAttribute("target", "_blank");
    linkElement.setAttribute("rel", "noreferrer");
  });
}

function postMeasuredHeight() {
  postEmbedMessage({
    type: EMBED_RESIZE_EVENT,
    height: measureEmbedHeight(),
  });
}

function measureEmbedHeight() {
  return Math.max(
    DEFAULT_MIN_HEIGHT,
    Math.ceil(document.documentElement.getBoundingClientRect().height),
    Math.ceil(document.body.getBoundingClientRect().height),
  );
}

function postEmbedMessage(payload) {
  if (window.parent === window) {
    return;
  }

  window.parent.postMessage(
    {
      source: EMBED_SOURCE,
      embedId,
      siteKey,
      hostname,
      ...payload,
    },
    parentOrigin,
  );
}

function normalizeRelativePath(value) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith("/")) {
    return null;
  }

  return trimmed;
}

function normalizeString(value) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeOrigin(value) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function normalizeHostname(value) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    if (trimmed.includes("://")) {
      return new URL(trimmed).host;
    }

    return new URL(`https://${trimmed}`).host;
  } catch {
    return null;
  }
}

function normalizeEmbedId(value) {
  const trimmedValue = normalizeString(value);
  if (!trimmedValue) {
    return null;
  }

  return trimmedValue.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function normalizeChallengeName(value) {
  const trimmedValue = normalizeString(value);
  if (!trimmedValue || !/^[a-z0-9_]+$/.test(trimmedValue)) {
    return null;
  }

  return trimmedValue;
}

function parseUrl(value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}
