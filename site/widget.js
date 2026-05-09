import {
  createInitialWidgetState,
  createStartChallengeRequestBody,
  createSubmitChallengeRequestBody,
  formatRemainingSeconds,
  getAnswerForPrompt,
  getChallengeMarkup,
  getFailureMessage,
  getProgressLabel,
  getProgressPercentage,
  getRemainingAttemptsMessage,
  getVisualStateName,
  resolveWidgetConfig,
  getWidgetMarkup,
  MAX_FAILURES,
} from "./widget-logic.js";

const chessBoardComponentReady = loadChessBoardComponent();
const VERIFICATION_STORAGE_KEY = "robot-check-verification";

class RobotCheckWidget extends HTMLElement {
  connectedCallback() {
    if (this.dataset.rendered === "true") {
      return;
    }

    this.dataset.rendered = "true";
    const config = resolveWidgetConfig(this, window.location.pathname);
    this.state = createInitialWidgetState(config);
    this.innerHTML = getWidgetMarkup(config);
    this.cacheDomReferences();
    this.registerEventHandlers();
    this.applyVisualState();
  }

  disconnectedCallback() {
    this.clearCountdownTimer();
  }

  cacheDomReferences() {
    this.checkbox = this.querySelector("#challenge-toggle");
    this.cardElement = this.querySelector(".widget-card");
    this.titleElement = this.querySelector('[data-role="widget-title"]');
    this.subtitleElement = this.querySelector('[data-role="widget-subtitle"]');
    this.statusElement = this.querySelector('[data-role="status"]');
    this.expandedElement = this.querySelector('[data-role="widget-expanded"]');
    this.challengeContainer = this.querySelector('[data-role="challenge-container"]');
    this.verifyButton = this.querySelector('[data-role="verify-button"]');
    this.resultElement = this.querySelector('[data-role="result"]');
    this.metaElement = this.querySelector('[data-role="widget-meta"]');
    this.challengeTypeElement = this.querySelector('[data-role="challenge-type"]');
    this.timerElement = this.querySelector('[data-role="timer"]');
    this.progressBarElement = this.querySelector('[data-role="progress-bar"]');
  }

  registerEventHandlers() {
    this.checkbox.addEventListener("change", () => {
      if (this.checkbox.checked) {
        void this.startVerificationFlow();
        return;
      }

      this.resetVerificationFlow({ preserveStatus: true });
    });

    this.verifyButton.addEventListener("click", () => {
      void this.submitCurrentAnswer();
    });
  }

  async startVerificationFlow() {
    if (this.state.attemptFailures >= MAX_FAILURES) {
      this.checkbox.checked = false;
      this.showFailureState("No attempts remaining.", false);
      return;
    }

    this.prepareInterfaceForVerification();
    await this.loadNextChallenge();
  }

  prepareInterfaceForVerification() {
    this.titleElement.textContent = "Prove it";
    this.subtitleElement.textContent = "Timed challenge verification";
    this.expandedElement.classList.remove("hidden");
    this.hideResultMessage();
    this.verifyButton.disabled = true;
    this.state.sessionId = null;
    this.state.verificationSessionId = null;
    this.state.challengePrompt = null;
    this.state.successfulChallenges = 0;
    this.state.requiredChallengesToPass = 1;
    this.state.verified = false;
    this.state.resultToken = null;
    this.state.resultTokenExpiresAt = null;
    this.updateProgressBar();
    this.challengeContainer.innerHTML = '<p class="muted">Loading challenge...</p>';
  }

  resetVerificationFlow({ preserveStatus = false } = {}) {
    this.clearCountdownTimer();
    this.state.sessionId = null;
    this.state.verificationSessionId = null;
    this.state.challengePrompt = null;
    this.state.deadlineAt = null;
    this.state.verified = false;
    this.state.resultToken = null;
    this.state.resultTokenExpiresAt = null;
    this.state.successfulChallenges = 0;
    this.state.requiredChallengesToPass = 1;

    if (!preserveStatus) {
      this.restoreDefaultCopy();
    }

    this.expandedElement.classList.add("hidden");
    this.metaElement.classList.add("hidden");
    this.challengeContainer.innerHTML = '<p class="muted">Check the box to load a challenge.</p>';
    this.hideResultMessage();
    this.verifyButton.disabled = true;
    this.updateProgressBar();
    this.applyVisualState();
  }

  restoreDefaultCopy() {
    this.titleElement.textContent = "I'm a robot";
    this.subtitleElement.textContent = "No humans allowed";
    this.statusElement.classList.add("hidden");
    this.statusElement.textContent = "";
  }

  async submitCurrentAnswer() {
    if (!this.state.sessionId) {
      return;
    }

    const answer = getAnswerForPrompt(this, this.state.challengePrompt);
    if (!answer) {
      this.showErrorMessage("Choose or enter an answer first.");
      return;
    }

    this.verifyButton.disabled = true;

    try {
      const response = await fetch(this.getChallengeSubmitUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createSubmitChallengeRequestBody(this.state.sessionId, answer)),
      });

      const responseData = await response.json();
      if (!responseData.success) {
        this.handleFailedVerification(responseData.reason);
        return;
      }

      if (!this.applyVerificationProgress(responseData)) {
        this.showErrorMessage("Could not verify challenge progress.");
        return;
      }
      this.updateProgressBar();

      if (responseData.verified) {
        this.storeVerificationToken(responseData.resultToken, responseData.expiresAt);
        this.finishVerification();
        return;
      }

      this.hideResultMessage();
      await this.loadNextChallenge();
    } catch (error) {
      this.showErrorMessage(String(error));
    } finally {
      this.verifyButton.disabled = this.state.verified;
    }
  }

  async loadNextChallenge() {
    this.verifyButton.disabled = true;
    this.challengeContainer.innerHTML = '<p class="muted">Loading challenge...</p>';

    try {
      const response = await fetch(this.getChallengeStartUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createStartChallengeRequestBody(
            this.state.config.siteKey,
            window.location.host,
            this.state.verificationSessionId,
          ),
        ),
      });

      const responseData = await response.json();
      if (!response.ok || !responseData.sessionId) {
        const message = responseData.error
          ? `Could not load challenge: ${responseData.error}`
          : "Could not load challenge.";
        this.showErrorMessage(message);
        return;
      }

      this.state.sessionId = responseData.sessionId;
      this.state.verificationSessionId = responseData.verificationSessionId;
      this.state.challengePrompt = responseData.challenge.prompt;
      this.state.deadlineAt = responseData.deadlineAt;
      if (!this.applyVerificationProgress(responseData)) {
        this.showErrorMessage("Could not load challenge: missing verification progress.");
        return;
      }
      this.challengeContainer.innerHTML = getChallengeMarkup(responseData.challenge.prompt);
      if (responseData.challenge.prompt.kind === "chess_puzzle") {
        await chessBoardComponentReady;
      }
      this.challengeTypeElement.textContent = getProgressLabel(
        this.state.successfulChallenges,
        this.state.requiredChallengesToPass,
      );
      this.metaElement.classList.remove("hidden");
      this.verifyButton.disabled = false;
      this.startCountdownTimer();
    } catch (error) {
      this.showErrorMessage(String(error));
    }
  }

  handleFailedVerification(reason) {
    clearStoredVerification();
    this.state.attemptFailures += 1;
    this.checkbox.checked = false;
    this.showFailureState(getFailureMessage(reason), true);
    this.resetVerificationFlow({ preserveStatus: true });
  }

  showFailureState(message, shouldShowAttemptsRemaining) {
    this.titleElement.textContent = "I'm a robot";
    this.subtitleElement.textContent = shouldShowAttemptsRemaining
      ? getRemainingAttemptsMessage(message, this.state.attemptFailures)
      : message;
    this.statusElement.classList.add("hidden");
    this.statusElement.textContent = "";
    this.applyVisualState();
  }

  finishVerification() {
    this.state.verified = true;
    this.showSuccessMessage("Verified.");
    this.subtitleElement.textContent = "Verification complete";
    this.statusElement.classList.add("hidden");
    this.checkbox.checked = true;
    this.verifyButton.disabled = true;
    this.clearCountdownTimer();
    this.applyVisualState();
    this.dispatchVerificationPassedEvent();
  }

  storeVerificationToken(resultToken, expiresAt) {
    this.state.resultToken = resultToken ?? null;
    this.state.resultTokenExpiresAt = expiresAt ?? null;
    persistVerificationToken(this.state.resultToken, this.state.resultTokenExpiresAt);
  }

  showSuccessMessage(message) {
    this.resultElement.textContent = message;
    this.resultElement.classList.remove("hidden", "widget-result-error");
    this.resultElement.classList.add("widget-result-success");
  }

  showErrorMessage(message) {
    this.resultElement.textContent = message;
    this.resultElement.classList.remove("hidden", "widget-result-success");
    this.resultElement.classList.add("widget-result-error");
  }

  hideResultMessage() {
    this.resultElement.classList.add("hidden");
    this.resultElement.textContent = "";
  }

  updateProgressBar() {
    this.progressBarElement.style.width = `${getProgressPercentage(
      this.state.successfulChallenges,
      this.state.requiredChallengesToPass,
    )}%`;
  }

  applyVisualState() {
    this.cardElement.classList.remove(
      "widget-state-normal",
      "widget-state-happy",
      "widget-state-suspicious",
      "widget-state-angry",
      "widget-state-dead",
    );
    this.cardElement.classList.add(getVisualStateName(this.state));
  }

  startCountdownTimer() {
    this.clearCountdownTimer();
    this.updateCountdownTimer();
    this.state.timerId = window.setInterval(() => this.updateCountdownTimer(), 200);
  }

  updateCountdownTimer() {
    if (!this.state.deadlineAt) {
      this.timerElement.textContent = "";
      return;
    }

    const countdown = formatRemainingSeconds(this.state.deadlineAt, Date.now());
    this.timerElement.textContent = countdown.label;

    if (countdown.remainingMs <= 0) {
      this.clearCountdownTimer();
    }
  }

  clearCountdownTimer() {
    if (!this.state.timerId) {
      return;
    }

    window.clearInterval(this.state.timerId);
    this.state.timerId = null;
  }

  getChallengeStartUrl() {
    return `${window.location.origin}${this.state.config.appBasePath}/api/challenge/start`;
  }

  getChallengeSubmitUrl() {
    return `${window.location.origin}${this.state.config.appBasePath}/api/challenge/submit`;
  }

  applyVerificationProgress(responseData) {
    if (!isValidVerificationProgress(responseData.verification)) {
      return false;
    }

    this.state.verificationSessionId = responseData.verificationSessionId ?? this.state.verificationSessionId;
    this.state.successfulChallenges = responseData.verification.successfulChallenges;
    this.state.requiredChallengesToPass = responseData.verification.requiredChallengesToPass;
    return true;
  }

  dispatchVerificationPassedEvent() {
    this.dispatchEvent(
      new CustomEvent("robot-verification-passed", {
        bubbles: true,
        detail: {
          resultToken: this.state.resultToken,
          expiresAt: this.state.resultTokenExpiresAt,
        },
      }),
    );
  }
}

customElements.define("robot-check-widget", RobotCheckWidget);

async function loadChessBoardComponent() {
  if (typeof window === "undefined") {
    return false;
  }

  if (customElements.get("chess-board")) {
    return true;
  }

  try {
    await import("https://unpkg.com/chessboard-element?module");
    return true;
  } catch (error) {
    console.warn("Could not load chessboard-element", error);
    return false;
  }
}

function persistVerificationToken(resultToken, expiresAt) {
  if (!resultToken || !expiresAt) {
    clearStoredVerification();
    return;
  }

  window.localStorage.setItem(
    VERIFICATION_STORAGE_KEY,
    JSON.stringify({
      resultToken,
      expiresAt,
    }),
  );
}

function clearStoredVerification() {
  window.localStorage.removeItem(VERIFICATION_STORAGE_KEY);
}

function isValidVerificationProgress(verification) {
  return (
    verification &&
    Number.isSafeInteger(verification.successfulChallenges) &&
    Number.isSafeInteger(verification.requiredChallengesToPass) &&
    verification.successfulChallenges >= 0 &&
    verification.requiredChallengesToPass >= 1
  );
}
