import "./widget.js";

const state = {
  apiBase: "",
  appBasePath: "",
  sessionId: null,
  challengeType: null,
  deadlineAt: null,
  timerId: null,
};

const challengeForm = document.getElementById("challenge-form");
const challengeContainer = document.getElementById("challenge-container");
const resultOutput = document.getElementById("result-output");
const siteKeyInput = document.getElementById("site-key-input");
const hostnameInput = document.getElementById("hostname-input");
const apiBaseInput = document.getElementById("api-base-input");
const submitButton = document.getElementById("submit-button");
const newChallengeButton = document.getElementById("new-challenge-button");
const challengeMeta = document.getElementById("challenge-meta");
const challengeTypeBadge = document.getElementById("challenge-type-badge");
const timerBadge = document.getElementById("timer-badge");

newChallengeButton.addEventListener("click", async () => {
  await startChallenge();
});

challengeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.sessionId) {
    return;
  }

  const answer = collectAnswer();
  if (!answer) {
    writeResult({ success: false, error: "missing_answer" });
    return;
  }

  submitButton.disabled = true;

  try {
    const response = await fetch(`${state.apiBase}/api/challenge/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        answer,
      }),
    });

    const data = await response.json();
    writeResult(data);
  } catch (error) {
    writeResult({ success: false, error: String(error) });
  } finally {
    submitButton.disabled = false;
  }
});

void startChallenge();

async function startChallenge() {
  clearTimer();
  state.appBasePath = detectAppBasePath();
  state.apiBase = resolveApiBase(apiBaseInput.value, state.appBasePath);
  state.sessionId = null;
  state.challengeType = null;
  state.deadlineAt = null;
  submitButton.disabled = true;

  challengeContainer.innerHTML = '<p class="muted">Loading challenge...</p>';
  challengeMeta.classList.add("hidden");

  try {
    const response = await fetch(`${state.apiBase}/api/challenge/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteKey: siteKeyInput.value.trim(),
        hostname: hostnameInput.value.trim(),
        mode: "prove_robot",
      }),
    });

    const data = await response.json();
    writeResult(data);

    if (!response.ok || !data.sessionId) {
      challengeContainer.innerHTML = '<p class="muted">Could not load challenge.</p>';
      return;
    }

    state.sessionId = data.sessionId;
    state.challengeType = data.challenge.type;
    state.deadlineAt = data.deadlineAt;
    renderChallenge(data.challenge.type, data.challenge.prompt);
    challengeMeta.classList.remove("hidden");
    challengeTypeBadge.textContent = data.challenge.type;
    submitButton.disabled = false;
    startTimer();
  } catch (error) {
    writeResult({ success: false, error: String(error) });
    challengeContainer.innerHTML = '<p class="muted">Could not load challenge.</p>';
  }
}

function renderChallenge(type, prompt) {
  if (type === "timed_math") {
    challengeContainer.innerHTML = `
      <div class="challenge-block">
        <p>${escapeHtml(prompt.question)}</p>
        <label>
          Answer
          <input type="text" id="answer-input" autocomplete="off" required>
        </label>
      </div>
    `;
    return;
  }

  if (type === "randomness_audit") {
    challengeContainer.innerHTML = `
      <div class="challenge-block">
        <p>${escapeHtml(prompt.description)}</p>
        <div class="choice-grid">
          ${prompt.choices
            .map(
              (choice) => `
                <label class="choice-card">
                  <input type="radio" name="answer-choice" value="${escapeHtml(choice.label)}">
                  <strong>${escapeHtml(choice.label)}</strong>
                  <code>${escapeHtml(choice.bits)}</code>
                </label>
              `,
            )
            .join("")}
        </div>
      </div>
    `;
    return;
  }

  if (type === "code_error") {
    challengeContainer.innerHTML = `
      <div class="challenge-block">
        <p>${escapeHtml(prompt.description)}</p>
        <pre class="code-block">${escapeHtml(prompt.code)}</pre>
        <div class="choice-list">
          ${prompt.choices
            .map(
              (choice) => `
                <label class="choice-line">
                  <input type="radio" name="answer-choice" value="${escapeHtml(choice.value)}">
                  <span>${escapeHtml(choice.label)}</span>
                </label>
              `,
            )
            .join("")}
        </div>
      </div>
    `;
  }
}

function collectAnswer() {
  if (state.challengeType === "timed_math") {
    const input = document.getElementById("answer-input");
    return { value: input?.value?.trim() ?? "" };
  }

  const checked = document.querySelector('input[name="answer-choice"]:checked');
  if (!checked) {
    return null;
  }

  return { value: checked.value };
}

function startTimer() {
  updateTimer();
  state.timerId = window.setInterval(updateTimer, 200);
}

function updateTimer() {
  if (!state.deadlineAt) {
    timerBadge.textContent = "";
    return;
  }

  const remainingMs = new Date(state.deadlineAt).getTime() - Date.now();
  const remainingSeconds = Math.max(0, remainingMs / 1000);
  timerBadge.textContent = `${remainingSeconds.toFixed(1)}s left`;

  if (remainingMs <= 0) {
    clearTimer();
  }
}

function clearTimer() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
}

function writeResult(data) {
  resultOutput.textContent = JSON.stringify(data, null, 2);
}

function normalizeApiBase(value) {
  return value.trim().replace(/\/+$/, "");
}

function resolveApiBase(value, appBasePath) {
  const normalized = normalizeApiBase(value);
  if (normalized) {
    return normalized;
  }

  return `${window.location.origin}${appBasePath}`;
}

function detectAppBasePath() {
  if (window.location.pathname === "/im-a-robot" || window.location.pathname.startsWith("/im-a-robot/")) {
    return "/im-a-robot";
  }

  return "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
