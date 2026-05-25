const VERIFICATION_STORAGE_KEY = "robot-check-verification";
const APP_BASE_PATH = "/im-a-robot";
const MESSAGE_PAGE_SIZE = 10;

const formElement = document.querySelector('[data-role="post-form"]');
const submitButton = document.querySelector('[data-role="submit-button"]');
const formStatus = document.querySelector('[data-role="form-status"]');
const messagesList = document.querySelector('[data-role="messages-list"]');
const messagesSummary = document.querySelector('[data-role="messages-summary"]');
const messagesMore = document.querySelector('[data-role="messages-more"]');
const loadOlderButton = document.querySelector('[data-role="messages-load-older"]');
const messagesMoreStatus = document.querySelector('[data-role="messages-more-status"]');
const messagesToggle = document.querySelector('[data-role="messages-toggle"]');
const messagesToggleLabel = document.querySelector('[data-role="messages-toggle-label"]');
const messagesPanel = document.querySelector('[data-role="messages-panel"]');

let verification = readStoredVerification();
let messageBoardState = {
  messages: [],
  totalCount: 0,
  nextCursor: null,
  isLoading: false,
};

syncComposerAccess();
syncMessagesToggle();
void loadMessages();

loadOlderButton?.addEventListener("click", () => {
  if (!messageBoardState.nextCursor) {
    return;
  }

  void loadMessages({ cursor: messageBoardState.nextCursor, append: true });
});

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

async function loadMessages({ cursor = null, append = false } = {}) {
  if (!messagesList) {
    return;
  }

  if (messageBoardState.isLoading) {
    return;
  }

  messageBoardState.isLoading = true;
  syncLoadOlderControls();
  if (append) {
    showMessagesMoreStatus("Loading older messages...", false);
  } else {
    clearMessagesMoreStatus();
    messagesList.innerHTML = '<p class="muted">Loading messages...</p>';
  }

  try {
    const requestUrl = new URL(`${window.location.origin}${APP_BASE_PATH}/api/messages`);
    requestUrl.searchParams.set("limit", String(MESSAGE_PAGE_SIZE));
    if (cursor) {
      requestUrl.searchParams.set("cursor", cursor);
    }

    const response = await fetch(requestUrl);
    const responseData = await response.json();

    if (!response.ok || !responseData.success) {
      if (append && messageBoardState.messages.length) {
        showMessagesMoreStatus(formatApiError(responseData.error), true);
        return;
      }

      messageBoardState = {
        messages: [],
        totalCount: 0,
        nextCursor: null,
        isLoading: true,
      };
      messagesList.innerHTML = `<p class="muted">${escapeHtml(formatApiError(responseData.error))}</p>`;
      if (messagesSummary) {
        messagesSummary.textContent = "";
      }
      clearMessagesMoreStatus();
      return;
    }

    const pageMessages = Array.isArray(responseData.messages) ? responseData.messages : [];
    const nextMessages = append ? [...messageBoardState.messages, ...pageMessages] : pageMessages;
    messageBoardState = {
      messages: nextMessages,
      totalCount: normalizeTotalCount(responseData.totalCount, nextMessages.length),
      nextCursor: normalizeCursor(responseData.nextCursor),
      isLoading: true,
    };
    clearMessagesMoreStatus();
    renderMessages();
  } catch (error) {
    if (append && messageBoardState.messages.length) {
      showMessagesMoreStatus(String(error), true);
      return;
    }

    messageBoardState = {
      messages: [],
      totalCount: 0,
      nextCursor: null,
      isLoading: true,
    };
    messagesList.innerHTML = `<p class="muted">${escapeHtml(String(error))}</p>`;
    if (messagesSummary) {
      messagesSummary.textContent = "";
    }
    clearMessagesMoreStatus();
  } finally {
    messageBoardState.isLoading = false;
    syncLoadOlderControls();
  }
}

function renderMessages() {
  const { messages, totalCount } = messageBoardState;
  if (messagesSummary) {
    messagesSummary.textContent = getMessagesSummaryLabel(messages.length, totalCount);
  }

  if (!messages.length) {
    messagesList.innerHTML = '<p class="muted">No posts yet.</p>';
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

function syncLoadOlderControls() {
  if (!messagesMore || !loadOlderButton) {
    return;
  }

  const hasMoreMessages = Boolean(messageBoardState.nextCursor);
  messagesMore.classList.toggle("hidden", !hasMoreMessages);
  loadOlderButton.disabled = messageBoardState.isLoading || !hasMoreMessages;
  loadOlderButton.textContent = messageBoardState.isLoading && hasMoreMessages ? "Loading..." : "Load older messages";
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

function showMessagesMoreStatus(message, isError) {
  if (!messagesMoreStatus) {
    return;
  }

  messagesMoreStatus.textContent = message;
  messagesMoreStatus.classList.toggle("message-board-more-status-error", isError);
}

function clearMessagesMoreStatus() {
  showMessagesMoreStatus("", false);
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
      <span>posted_via: ${escapeHtml(formatPostSource(verification.source))}</span>
      <span>verified_ms: ${escapeHtml(formatDurationMs(verification.verificationDurationMs))}</span>
      <span>challenges_passed: ${escapeHtml(formatChallengeCount(verification.successfulChallenges))}</span>
      <span>attempt: ${escapeHtml(normalizeAttemptNumber(verification.attemptNumber))}</span>
    </div>
  `;
}

function formatPostSource(source) {
  return source === "widget_gui" ? "widget_gui" : "api";
}

function formatChallengeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function formatDurationMs(value) {
  if (!Number.isFinite(value) || value < 0) {
    return "unknown";
  }

  return String(Math.round(value)).padStart(2, "0");
}

function normalizeAttemptNumber(value) {
  return Number.isSafeInteger(value) && value >= 1 ? value : 1;
}

function normalizeTotalCount(value, minimum) {
  return Number.isSafeInteger(value) && value >= minimum ? value : minimum;
}

function normalizeCursor(value) {
  return typeof value === "string" && value ? value : null;
}

function getMessagesSummaryLabel(visibleCount, totalCount) {
  if (totalCount > visibleCount) {
    return `Showing ${visibleCount} of ${formatPostCount(totalCount)}`;
  }

  return formatPostCount(totalCount);
}

function formatPostCount(value) {
  return value === 1 ? "1 post" : `${value} posts`;
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
