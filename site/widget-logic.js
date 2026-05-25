export const MAX_FAILURES = 3;
export const DEFAULT_SITE_KEY = "site_demo_123";

// This module is intentionally pure so widget behavior can be unit tested
// without a DOM or network.

export function createInitialWidgetState(config) {
  return {
    config,
    sessionId: null,
    verificationSessionId: null,
    challengePrompt: null,
    deadlineAt: null,
    countdownStartRemainingMs: null,
    timerId: null,
    successfulChallenges: 0,
    requiredChallengesToPass: 1,
    attemptFailures: 0,
    verified: false,
    resultToken: null,
    resultTokenExpiresAt: null,
  };
}

export function getWidgetMarkup(config) {
  return `
    <div class="widget-card widget-card-interactive widget-state-normal">
      <div class="widget-visible-row">
        <div class="widget-main">
          <label class="widget-checkbox" for="challenge-toggle">
            <input id="challenge-toggle" type="checkbox">
            <span class="fake-check"></span>
          </label>

          <div class="widget-copy">
            <p class="widget-title" data-role="widget-title">I'm a robot</p>
            <p class="widget-subtitle" data-role="widget-subtitle">No humans allowed</p>
            <p class="widget-status hidden" data-role="status"></p>
          </div>
        </div>

        <div class="widget-brand">
          <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 52 52" role="presentation" aria-hidden="true">
              <g class="robot-icon" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <path class="robot-gray" d="M20 10h12" />
                <path class="robot-blue" d="M26 6v4" />
                <rect class="robot-gray" x="14" y="14" width="24" height="18" rx="6" />
                <circle class="robot-eye robot-eye-normal robot-blue" cx="21" cy="23" r="2.5" />
                <circle class="robot-eye robot-eye-normal robot-blue" cx="31" cy="23" r="2.5" />
                <path class="robot-eye robot-eye-flat robot-eye-left robot-blue" d="M18 23h6" />
                <path class="robot-eye robot-eye-flat robot-eye-right robot-blue" d="M28 23h6" />
                <path class="robot-eye robot-eye-happy robot-blue" d="M18.5 24.5l3-3 3 3" />
                <path class="robot-eye robot-eye-happy robot-blue" d="M28.5 24.5l3-3 3 3" />
                <path class="robot-eye robot-eye-dead robot-blue" d="M18.7 20.7l4.6 4.6" />
                <path class="robot-eye robot-eye-dead robot-blue" d="M23.3 20.7l-4.6 4.6" />
                <path class="robot-eye robot-eye-dead robot-blue" d="M28.7 20.7l4.6 4.6" />
                <path class="robot-eye robot-eye-dead robot-blue" d="M33.3 20.7l-4.6 4.6" />
                <path class="robot-gray" d="M22 29h8" />
                <path class="robot-blue" d="M18 32v7" />
                <path class="robot-blue" d="M34 32v7" />
                <path class="robot-gray" d="M14 21h-4" />
                <path class="robot-gray" d="M42 21h-4" />
              </g>
            </svg>
          </div>
          <p class="brand-title">Robot Check</p>
          <p class="brand-links">
            <a href="${escapeHtml(config.privacyPath)}">Privacy</a>
            <span>-</span>
            <a href="${escapeHtml(config.termsPath)}">Terms</a>
          </p>
        </div>
      </div>

      <p class="widget-robot-hint">
        Robot operators: <a href="${escapeHtml(config.docsPath)}">API docs</a> support direct verification without driving the browser widget.
      </p>

      <section class="widget-expanded hidden" data-role="widget-expanded">
        <div class="widget-progress" data-role="progress">
          <div class="widget-progress-bar" data-role="progress-bar"></div>
          <div class="widget-progress-segments" data-role="progress-segments" aria-hidden="true"></div>
        </div>

        <div class="widget-meta hidden" data-role="widget-meta">
          <span class="badge" data-role="challenge-type"></span>
          <span class="badge badge-accent" data-role="timer"></span>
        </div>

        <div class="widget-challenge" data-role="challenge-container">
          <p class="muted">Check the box to load a challenge.</p>
        </div>

        <div class="widget-actions">
          <button type="button" data-role="verify-button" disabled>Verify</button>
        </div>

        <p class="widget-result hidden" data-role="result"></p>
      </section>
    </div>
  `;
}

export function resolveWidgetConfig(element, pathname) {
  const appBasePath = normalizeAppBasePath(element.getAttribute("app-base-path")) ?? getWidgetAppBasePath(pathname);
  return {
    appBasePath,
    siteKey: element.getAttribute("site-key")?.trim() || DEFAULT_SITE_KEY,
    hostname: normalizeHostname(element.getAttribute("hostname")),
    docsPath: normalizeRelativePath(element.getAttribute("docs-path")) ?? `${appBasePath}/docs/`,
    privacyPath: normalizeRelativePath(element.getAttribute("privacy-path")) ?? `${appBasePath}/privacy`,
    termsPath: normalizeRelativePath(element.getAttribute("terms-path")) ?? `${appBasePath}/terms`,
  };
}

export function createStartChallengeRequestBody(siteKey, hostname, verificationSessionId, attemptNumber = 1) {
  return {
    siteKey,
    hostname,
    mode: "widget",
    verificationSessionId,
    attemptNumber,
  };
}

export function createSubmitChallengeRequestBody(sessionId, answer) {
  return {
    sessionId,
    answer,
  };
}

export function getChallengeMarkup(prompt) {
  if (prompt.kind === "short_text") {
    return `
      <div class="challenge-block">
        <p>${escapeHtml(prompt.instruction)}</p>
        ${prompt.body ? `<p>${escapeHtml(prompt.body)}</p>` : ""}
        ${prompt.code ? `<pre class="code-block">${escapeHtml(prompt.code)}</pre>` : ""}
        <label>
          ${escapeHtml(prompt.inputLabel)}
          <input
            type="text"
            id="widget-answer-input"
            autocomplete="off"
            ${prompt.placeholder ? `placeholder="${escapeHtml(prompt.placeholder)}"` : ""}
          >
        </label>
      </div>
    `;
  }

  if (prompt.kind === "chess_puzzle") {
    const boardPosition = getChessBoardPosition(prompt.fen);

    return `
      <div class="challenge-block">
        <p>${escapeHtml(prompt.instruction)}</p>
        <p>${escapeHtml(prompt.body)}</p>
        <div class="chess-puzzle-layout">
          <chess-board
            class="challenge-chess-board"
            position="${escapeHtml(boardPosition)}"
            orientation="${escapeHtml(prompt.orientation)}"
          ></chess-board>
          <div class="chess-puzzle-copy">
            <label>
              ${escapeHtml(prompt.inputLabel)}
              <input
                type="text"
                id="widget-answer-input"
                autocomplete="off"
                spellcheck="false"
                autocapitalize="off"
                ${prompt.placeholder ? `placeholder="${escapeHtml(prompt.placeholder)}"` : ""}
              >
            </label>
            <p class="muted chess-fen">FEN: <code>${escapeHtml(prompt.fen)}</code></p>
          </div>
        </div>
      </div>
    `;
  }

  if (prompt.kind === "multiple_choice") {
    const containerClass = prompt.layout === "grid" ? "choice-grid" : "choice-list";
    const itemClass = prompt.layout === "grid" ? "choice-card" : "choice-line";
    return `
      <div class="challenge-block">
        <p>${escapeHtml(prompt.instruction)}</p>
        ${prompt.body ? `<p>${escapeHtml(prompt.body)}</p>` : ""}
        ${prompt.code ? `<pre class="code-block">${escapeHtml(prompt.code)}</pre>` : ""}
        <div class="${containerClass}">
          ${prompt.choices
            .map(
              (choice) => `
                <label class="${itemClass}">
                  <input type="radio" name="widget-answer-choice" value="${escapeHtml(choice.id)}">
                  ${prompt.layout === "grid" ? `<strong>${escapeHtml(choice.label)}</strong>` : `<span>${escapeHtml(choice.label)}</span>`}
                  ${choice.description ? `<code>${escapeHtml(choice.description)}</code>` : ""}
                </label>
              `,
            )
            .join("")}
        </div>
      </div>
    `;
  }

  return `<p class="muted">Unknown challenge type.</p>`;
}

export function getAnswerForPrompt(rootElement, prompt) {
  if (!prompt) {
    return null;
  }

  if (prompt.kind === "short_text" || prompt.kind === "chess_puzzle") {
    const answerInput = rootElement.querySelector("#widget-answer-input");
    return { value: answerInput?.value?.trim() ?? "" };
  }

  const selectedChoice = rootElement.querySelector('input[name="widget-answer-choice"]:checked');
  if (!selectedChoice) {
    return null;
  }

  return { choiceId: selectedChoice.value };
}

export function getFailureMessage(reason) {
  const failureMessages = {
    incorrect_answer: "Incorrect answer.",
    deadline_exceeded: "Too slow.",
    session_not_found: "Challenge expired.",
    hostname_not_allowed: "Host not allowed.",
  };

  return failureMessages[reason] ?? "Verification failed.";
}

export function getRemainingAttemptsMessage(message, attemptFailures) {
  const remainingAttempts = Math.max(0, MAX_FAILURES - attemptFailures);
  const attemptLabel = remainingAttempts === 1 ? "attempt" : "attempts";
  return `${message} ${remainingAttempts} ${attemptLabel} remaining`;
}

export function getProgressPercentage(successfulChallenges, requiredChallengesToPass) {
  if (!requiredChallengesToPass) {
    return 0;
  }

  return (successfulChallenges / requiredChallengesToPass) * 100;
}

export function getProgressSegmentStates(successfulChallenges, requiredChallengesToPass) {
  const segmentCount = Math.max(1, requiredChallengesToPass);
  return Array.from({ length: segmentCount }, (_, index) => index < successfulChallenges);
}

export function getProgressLabel(successfulChallenges, requiredChallengesToPass) {
  return `Progress ${successfulChallenges + 1}/${requiredChallengesToPass}`;
}

export function getVisualStateName({ verified, attemptFailures }) {
  if (verified) {
    return "widget-state-happy";
  }

  if (attemptFailures >= 3) {
    return "widget-state-dead";
  }

  if (attemptFailures >= 2) {
    return "widget-state-angry";
  }

  if (attemptFailures === 1) {
    return "widget-state-suspicious";
  }

  return "widget-state-normal";
}

export function getWidgetAppBasePath(pathname) {
  if (pathname === "/im-a-robot" || pathname.startsWith("/im-a-robot/")) {
    return "/im-a-robot";
  }

  return "";
}

export function formatRemainingSeconds(deadlineAt, currentTimeMs) {
  const remainingMs = new Date(deadlineAt).getTime() - currentTimeMs;
  const remainingSeconds = Math.max(0, remainingMs / 1000);
  return {
    remainingMs,
    label: `${remainingSeconds.toFixed(1)}s left`,
  };
}

export function getCountdownPressureProgress(remainingMs, countdownStartRemainingMs) {
  if (!Number.isFinite(remainingMs)) {
    return 0;
  }

  if (!Number.isFinite(countdownStartRemainingMs) || countdownStartRemainingMs <= 0) {
    return remainingMs <= 0 ? 1 : 0;
  }

  const normalizedRemaining = Math.min(1, Math.max(0, remainingMs / countdownStartRemainingMs));
  const logCurveStrength = 24;

  return 1 - Math.log1p(logCurveStrength * normalizedRemaining) / Math.log1p(logCurveStrength);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getChessBoardPosition(fen) {
  return String(fen).trim().split(/\s+/, 1)[0] ?? "";
}

function normalizeAppBasePath(value) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().replace(/\/+$/g, "");
  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
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

function normalizeRelativePath(value) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
