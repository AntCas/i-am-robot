const EMBED_SOURCE = "robot-check-embed";
const EMBED_READY_EVENT = "robot-check-ready";
const EMBED_RESIZE_EVENT = "robot-check-resize";
const VERIFICATION_PASSED_EVENT = "robot-verification-passed";
const DEFAULT_IFRAME_HEIGHT = 188;
const DEFAULT_SITE_KEY = "site_demo_123";
const CONTAINER_SELECTOR = "[data-robot-check]";

const scriptUrl = new URL(import.meta.url);
const serviceOrigin = scriptUrl.origin;
const serviceBasePath = scriptUrl.pathname.replace(/\/[^/]*$/, "");
const mountedEmbeds = new Map();

window.addEventListener("message", handleEmbedMessage);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountAllEmbeds, { once: true });
} else {
  mountAllEmbeds();
}

function mountAllEmbeds() {
  document.querySelectorAll(CONTAINER_SELECTOR).forEach((containerElement, index) => {
    mountEmbedContainer(containerElement, index);
  });
}

function mountEmbedContainer(containerElement, index) {
  if (containerElement.dataset.robotCheckMounted === "true") {
    return;
  }

  containerElement.dataset.robotCheckMounted = "true";

  const siteKey = normalizeString(containerElement.dataset.siteKey) ?? DEFAULT_SITE_KEY;
  const hostname = normalizeHostname(containerElement.dataset.hostname) ?? window.location.host;
  const parentOrigin = normalizeOrigin(containerElement.dataset.parentOrigin) ?? window.location.origin;
  const embedId = normalizeEmbedId(containerElement.dataset.embedId) ?? `robot-check-${index + 1}`;
  const title = normalizeString(containerElement.dataset.title) ?? "Robot verification";
  const iframeUrl = createEmbedUrl({
    siteKey,
    hostname,
    parentOrigin,
    embedId,
    docsPath: containerElement.dataset.docsPath,
    privacyPath: containerElement.dataset.privacyPath,
    termsPath: containerElement.dataset.termsPath,
  });

  const iframeElement = document.createElement("iframe");
  iframeElement.src = iframeUrl.toString();
  iframeElement.title = title;
  iframeElement.loading = "lazy";
  iframeElement.referrerPolicy = "strict-origin-when-cross-origin";
  iframeElement.setAttribute("scrolling", "no");
  iframeElement.style.width = "100%";
  iframeElement.style.height = `${DEFAULT_IFRAME_HEIGHT}px`;
  iframeElement.style.minHeight = `${DEFAULT_IFRAME_HEIGHT}px`;
  iframeElement.style.display = "block";
  iframeElement.style.border = "0";
  iframeElement.style.background = "transparent";
  iframeElement.style.overflow = "hidden";

  containerElement.replaceChildren(iframeElement);
  mountedEmbeds.set(embedId, {
    containerElement,
    iframeElement,
  });
}

function createEmbedUrl({ siteKey, hostname, parentOrigin, embedId, docsPath, privacyPath, termsPath }) {
  const embedUrl = new URL(`${serviceBasePath}/embed`, serviceOrigin);
  embedUrl.searchParams.set("siteKey", siteKey);
  embedUrl.searchParams.set("hostname", hostname);
  embedUrl.searchParams.set("parentOrigin", parentOrigin);
  embedUrl.searchParams.set("embedId", embedId);

  appendOptionalPath(embedUrl, "docsPath", docsPath);
  appendOptionalPath(embedUrl, "privacyPath", privacyPath);
  appendOptionalPath(embedUrl, "termsPath", termsPath);

  return embedUrl;
}

function appendOptionalPath(embedUrl, parameterName, value) {
  const normalizedPath = normalizeRelativePath(value);
  if (normalizedPath) {
    embedUrl.searchParams.set(parameterName, normalizedPath);
  }
}

function handleEmbedMessage(event) {
  if (event.origin !== serviceOrigin) {
    return;
  }

  const message = event.data;
  if (!message || message.source !== EMBED_SOURCE || typeof message.embedId !== "string") {
    return;
  }

  const mountedEmbed = mountedEmbeds.get(message.embedId);
  if (!mountedEmbed || event.source !== mountedEmbed.iframeElement.contentWindow) {
    return;
  }

  if (message.type === EMBED_RESIZE_EVENT && Number.isFinite(message.height)) {
    const nextHeight = Math.max(DEFAULT_IFRAME_HEIGHT, Math.ceil(message.height));
    mountedEmbed.iframeElement.style.height = `${nextHeight}px`;
    dispatchEmbedEvent(mountedEmbed, EMBED_RESIZE_EVENT, {
      embedId: message.embedId,
      height: nextHeight,
    });
    return;
  }

  if (message.type === EMBED_READY_EVENT) {
    dispatchEmbedEvent(mountedEmbed, EMBED_READY_EVENT, {
      embedId: message.embedId,
      siteKey: message.siteKey,
      hostname: message.hostname,
    });
    return;
  }

  if (message.type === VERIFICATION_PASSED_EVENT) {
    dispatchEmbedEvent(mountedEmbed, VERIFICATION_PASSED_EVENT, {
      embedId: message.embedId,
      ...message.detail,
    });
  }
}

function dispatchEmbedEvent(mountedEmbed, eventName, detail) {
  const targets = [mountedEmbed.containerElement, mountedEmbed.iframeElement, window];

  targets.forEach((target) => {
    target.dispatchEvent(
      new CustomEvent(eventName, {
        detail,
      }),
    );
  });
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
