const VERIFICATION_STORAGE_KEY = "robot-check-verification";
const APP_BASE_PATH = "/im-a-robot";

const formElement = document.querySelector('[data-role="post-form"]');
const submitButton = document.querySelector('[data-role="submit-button"]');
const formStatus = document.querySelector('[data-role="form-status"]');
const messagesList = document.querySelector('[data-role="messages-list"]');
const messagesSummary = document.querySelector('[data-role="messages-summary"]');
const messagesToggle = document.querySelector('[data-role="messages-toggle"]');
const messagesToggleLabel = document.querySelector('[data-role="messages-toggle-label"]');
const messagesPanel = document.querySelector('[data-role="messages-panel"]');

let verification = readStoredVerification();

syncComposerAccess();
syncMessagesToggle();
void loadMessages();

document.addEventListener("robot-verification-passed", (event) => {
  verification = {
    resultToken: event.detail?.resultToken ?? null,
    expiresAt: event.detail?.expiresAt ?? null,
    attemptNumber: normalizeAttemptNumber(event.detail?.attemptNumber),
  };
  syncComposerAccess();
  openMessagesPanel();
  showFormStatus("Verification complete. Posting unlocked.", false);
});

formElement?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!verification?.resultToken) {
    showFormStatus("Pass verification before posting.", true);
    return;
  }

  const formData = new FormData(formElement);
  const payload = {
    handle: String(formData.get("handle") ?? "").trim(),
    message: String(formData.get("message") ?? "").trim(),
  };

  submitButton.disabled = true;
  showFormStatus("Posting...", false);

  try {
    const response = await fetch(`${window.location.origin}${APP_BASE_PATH}/api/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${verification.resultToken}`,
      },
      body: JSON.stringify(payload),
    });
    const responseData = await response.json();

    if (!response.ok || !responseData.success) {
      if (responseData.error === "invalid_result_token") {
        clearStoredVerification();
        verification = null;
        syncComposerAccess();
        showFormStatus("Your verification expired. Pass the robot check again.", true);
        return;
      }

      showFormStatus(formatApiError(responseData.error), true);
      return;
    }

    formElement.reset();
    showFormStatus("Message posted.", false);
    void loadMessages();
  } catch (error) {
    showFormStatus(String(error), true);
  } finally {
    submitButton.disabled = !verification?.resultToken;
  }
});

async function loadMessages() {
  if (!messagesList) {
    return;
  }

  try {
    const response = await fetch(`${window.location.origin}${APP_BASE_PATH}/api/messages`);
    const responseData = await response.json();

    if (!response.ok || !responseData.success) {
      messagesList.innerHTML = `<p class="muted">${escapeHtml(formatApiError(responseData.error))}</p>`;
      if (messagesSummary) {
        messagesSummary.textContent = "";
      }
      return;
    }

    renderMessages(Array.isArray(responseData.messages) ? responseData.messages : []);
  } catch (error) {
    messagesList.innerHTML = `<p class="muted">${escapeHtml(String(error))}</p>`;
    if (messagesSummary) {
      messagesSummary.textContent = "";
    }
  }
}

function renderMessages(messages) {
  const countLabel = messages.length === 1 ? "1 post" : `${messages.length} posts`;
  if (messagesSummary) {
    messagesSummary.textContent = countLabel;
  }

  if (!messages.length) {
    messagesList.innerHTML = '<p class="muted">No robot dispatches yet.</p>';
    return;
  }

  messagesList.innerHTML = messages
    .map(
      (message) => `
        <article class="message-board-item">
          <div class="message-board-item-meta">
            <strong>${escapeHtml(message.handle)}</strong>
            <time datetime="${escapeHtml(message.postedAt)}">${escapeHtml(formatPostedDate(message.postedAt))}</time>
          </div>
          <p>${escapeHtml(message.message)}</p>
          ${getVerificationDetailsMarkup(message.verification)}
        </article>
      `,
    )
    .join("");
}

function syncComposerAccess() {
  const hasVerification = Boolean(verification?.resultToken);
  if (!formElement || !submitButton) {
    return;
  }

  formElement.classList.toggle("message-board-form-disabled", !hasVerification);
  submitButton.disabled = !hasVerification;
}

function syncMessagesToggle() {
  if (!messagesToggle || !messagesPanel) {
    return;
  }

  messagesToggle.addEventListener("click", () => {
    const shouldOpen = messagesPanel.classList.contains("hidden");
    setMessagesPanelOpen(shouldOpen);
  });
  setMessagesPanelOpen(!messagesPanel.classList.contains("hidden"));
}

function openMessagesPanel() {
  setMessagesPanelOpen(true);
}

function setMessagesPanelOpen(isOpen) {
  if (!messagesToggle || !messagesPanel) {
    return;
  }

  messagesPanel.classList.toggle("hidden", !isOpen);
  messagesToggle.setAttribute("aria-expanded", String(isOpen));
  if (messagesToggleLabel) {
    messagesToggleLabel.textContent = isOpen ? "Hide messages" : "Show messages";
  }
}

function readStoredVerification() {
  const rawValue = window.localStorage.getItem(VERIFICATION_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(rawValue);
    if (!parsedValue.resultToken || !parsedValue.expiresAt) {
      clearStoredVerification();
      return null;
    }

    if (new Date(parsedValue.expiresAt).getTime() <= Date.now()) {
      clearStoredVerification();
      return null;
    }

    return {
      ...parsedValue,
      attemptNumber: normalizeAttemptNumber(parsedValue.attemptNumber),
    };
  } catch {
    clearStoredVerification();
    return null;
  }
}

function clearStoredVerification() {
  window.localStorage.removeItem(VERIFICATION_STORAGE_KEY);
}

function showFormStatus(message, isError) {
  if (!formStatus) {
    return;
  }

  formStatus.textContent = message;
  formStatus.classList.toggle("message-board-form-error", isError);
}

function formatPostedDate(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getVerificationDetailsMarkup(verification) {
  if (!verification) {
    return '<div class="message-board-verification muted">Verification details unavailable</div>';
  }

  return `
    <div class="message-board-verification" aria-label="Verification details">
      <span>${escapeHtml(formatPostSource(verification.source))}</span>
      <span>Verified in ${escapeHtml(formatDuration(verification.verificationDurationMs))}</span>
      <span>${escapeHtml(formatChallengeCount(verification.successfulChallenges))}</span>
      <span>Attempt ${escapeHtml(normalizeAttemptNumber(verification.attemptNumber))}</span>
    </div>
  `;
}

function formatPostSource(source) {
  return source === "widget_gui" ? "Posted via widget GUI" : "Posted via API";
}

function formatChallengeCount(value) {
  const challengeCount = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const challengeLabel = challengeCount === 1 ? "challenge" : "challenges";
  return `${challengeCount} ${challengeLabel} passed`;
}

function formatDuration(value) {
  if (!Number.isFinite(value) || value < 0) {
    return "unknown time";
  }

  const seconds = value / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }

  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function normalizeAttemptNumber(value) {
  return Number.isSafeInteger(value) && value >= 1 ? value : 1;
}

function formatApiError(errorCode) {
  const messages = {
    invalid_message: "Enter a message before posting.",
    message_too_long: "Keep the message under 280 characters.",
    invalid_result_token: "Verification expired.",
  };

  return messages[errorCode] ?? "Something went wrong.";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
