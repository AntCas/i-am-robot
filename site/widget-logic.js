export const MAX_VERIFICATION_STREAK = 3;
export const DEFAULT_SITE_KEY = "site_demo_123";

// This module is intentionally pure so widget behavior can be unit tested
// without a DOM or network.

export function createInitialWidgetState(appBasePath) {
  return {
    appBasePath,
    sessionId: null,
    challengeType: null,
    deadlineAt: null,
    timerId: null,
    streakCount: 0,
    attemptFailures: 0,
    verified: false,
    resultToken: null,
    resultTokenExpiresAt: null,
  };
}

export function getWidgetMarkup() {
  return `
    <div class="widget-card widget-card-interactive widget-state-normal">
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
          <a href="/im-a-robot/privacy">Privacy</a>
          <span>-</span>
          <a href="/im-a-robot/terms">Terms</a>
        </p>
      </div>

      <section class="widget-expanded hidden" data-role="widget-expanded">
        <div class="widget-progress" data-role="progress">
          <div class="widget-progress-bar" data-role="progress-bar"></div>
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

export function createStartChallengeRequestBody(hostname) {
  return {
    siteKey: DEFAULT_SITE_KEY,
    hostname,
    mode: "prove_robot",
  };
}

export function createSubmitChallengeRequestBody(sessionId, answer) {
  return {
    sessionId,
    answer,
  };
}

export function getChallengeMarkup(type, prompt) {
  if (type === "timed_math") {
    return `
      <div class="challenge-block">
        <p>${escapeHtml(prompt.question)}</p>
        <label>
          Answer
          <input type="text" id="widget-answer-input" autocomplete="off">
        </label>
      </div>
    `;
  }

  if (type === "randomness_audit") {
    return `
      <div class="challenge-block">
        <p>${escapeHtml(prompt.description)}</p>
        <div class="choice-grid">
          ${prompt.choices
            .map(
              (choice) => `
                <label class="choice-card">
                  <input type="radio" name="widget-answer-choice" value="${escapeHtml(choice.label)}">
                  <strong>${escapeHtml(choice.label)}</strong>
                  <code>${escapeHtml(choice.bits)}</code>
                </label>
              `,
            )
            .join("")}
        </div>
      </div>
    `;
  }

  if (type === "code_error") {
    return `
      <div class="challenge-block">
        <p>${escapeHtml(prompt.description)}</p>
        <pre class="code-block">${escapeHtml(prompt.code)}</pre>
        <div class="choice-list">
          ${prompt.choices
            .map(
              (choice) => `
                <label class="choice-line">
                  <input type="radio" name="widget-answer-choice" value="${escapeHtml(choice.value)}">
                  <span>${escapeHtml(choice.label)}</span>
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

export function getAnswerForChallengeType(rootElement, challengeType) {
  if (challengeType === "timed_math") {
    const answerInput = rootElement.querySelector("#widget-answer-input");
    return { value: answerInput?.value?.trim() ?? "" };
  }

  const selectedChoice = rootElement.querySelector('input[name="widget-answer-choice"]:checked');
  if (!selectedChoice) {
    return null;
  }

  return { value: selectedChoice.value };
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
  const remainingAttempts = Math.max(0, MAX_VERIFICATION_STREAK - attemptFailures);
  const attemptLabel = remainingAttempts === 1 ? "attempt" : "attempts";
  return `${message} ${remainingAttempts} ${attemptLabel} remaining`;
}

export function getProgressPercentage(streakCount) {
  return (streakCount / MAX_VERIFICATION_STREAK) * 100;
}

export function getProgressLabel(streakCount) {
  return `Progress ${streakCount + 1}/${MAX_VERIFICATION_STREAK}`;
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

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
