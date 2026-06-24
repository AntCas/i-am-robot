import {
  createInitialWidgetState,
  createStartChallengeRequestBody,
  createSubmitChallengeRequestBody,
  formatApiExchange,
  formatRemainingSeconds,
  getCountdownPressureProgress,
  getAnswerForPrompt,
  getChallengeMarkup,
  getFailureMessage,
  getProgressLabel,
  getProgressPercentage,
  getProgressSegmentStates,
  getRemainingAttemptsMessage,
  getVisualStateName,
  resolveWidgetConfig,
  getWidgetMarkup,
  MAX_FAILURES,
} from "./widget-logic.js";

const chessBoardComponentReady = loadChessBoardComponent();
const VERIFICATION_STORAGE_KEY = "robot-check-verification";
const PAGE_COUNTDOWN_DARKNESS_VAR = "--page-countdown-darkness";
const PAGE_COUNTDOWN_VIGNETTE_VAR = "--page-countdown-vignette";
const MAX_PAGE_COUNTDOWN_DARKNESS = 0.72;
const MAX_PAGE_COUNTDOWN_VIGNETTE = 0.78;
const BARB_ANIMATION_DURATION_MS = 2200;
const BARB_HOLD_DURATION_MS = BARB_ANIMATION_DURATION_MS * 2;

class RobotCheckWidget extends HTMLElement {
  connectedCallback() {
    if (this.dataset.rendered === "true") {
      return;
    }

    this.dataset.rendered = "true";
    const config = resolveWidgetConfig(this, window.location.pathname, window.location.search);
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
    this.progressSegmentsElement = this.querySelector('[data-role="progress-segments"]');
    this.apiPreviewElement = this.querySelector('[data-role="api-preview"]');
    this.apiPreviewBodyElement = this.querySelector('[data-role="api-preview-body"]');
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

    this.challengeContainer.addEventListener("click", (event) => {
      this.handleChallengeClick(event);
    });
    this.challengeContainer.addEventListener("mousemove", (event) => {
      this.handleChallengeHover(event);
    });
    this.challengeContainer.addEventListener("mouseleave", () => {
      clearWordSearchPreview(this.challengeContainer);
    });
    this.challengeContainer.addEventListener("input", () => {
      this.renderApiPreview();
    });
    this.challengeContainer.addEventListener("change", () => {
      this.renderApiPreview();
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
    resetPageCountdownEffect();
    const demoChallenge = this.state.config.demoChallenge;
    this.titleElement.textContent = demoChallenge ? "Demo challenge" : "Prove it";
    this.subtitleElement.textContent = demoChallenge ? demoChallenge : "Timed challenge verification";
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
    this.state.isDemo = Boolean(this.state.config.demoChallenge);
    this.resetApiPreview();
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
    this.state.isDemo = Boolean(this.state.config.demoChallenge);
    this.state.successfulChallenges = 0;
    this.state.requiredChallengesToPass = 1;

    if (!preserveStatus) {
      this.restoreDefaultCopy();
    }

    this.resetApiPreview();
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

    const submitRequestBody = createSubmitChallengeRequestBody(this.state.sessionId, answer);

    try {
      const response = await fetch(this.getChallengeSubmitUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitRequestBody),
      });

      const responseData = await response.json();
      this.recordSubmitExchange(submitRequestBody, responseData);
      if (!responseData.success) {
        await this.handleFailedVerification(responseData);
        return;
      }

      if (!this.applyVerificationProgress(responseData)) {
        this.showErrorMessage("Could not verify challenge progress.");
        return;
      }
      this.updateProgressBar();

      if (responseData.verified) {
        if (responseData.demo) {
          this.finishDemoVerification(responseData);
          return;
        }

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

    const startRequestBody = createStartChallengeRequestBody(
      this.state.config.siteKey,
      this.state.config.hostname || window.location.host,
      this.state.verificationSessionId,
      this.getCurrentAttemptNumber(),
      this.state.config.demoChallenge,
    );

    try {
      const response = await fetch(this.getChallengeStartUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(startRequestBody),
      });

      const responseData = await response.json();
      this.recordStartExchange(startRequestBody, responseData);
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
      this.updateProgressBar();
      this.metaElement.classList.remove("hidden");
      this.verifyButton.disabled = false;
      this.renderApiPreview();
      this.startCountdownTimer();
    } catch (error) {
      this.showErrorMessage(String(error));
    }
  }

  async handleFailedVerification(responseData) {
    clearStoredVerification();
    this.state.attemptFailures += 1;
    this.checkbox.checked = false;
    const message = responseData.barb || getFailureMessage(responseData.reason);
    this.showBarbMessage(message);
    await this.playChallengeBarb(responseData);
    this.showFailureState(message, true);
    this.resetVerificationFlow({ preserveStatus: true });
  }

  async playChallengeBarb(responseData) {
    if (!responseData.barb || !this.state.challengePrompt) {
      return;
    }

    if (this.state.challengePrompt.kind === "point_click") {
      renderPointClickBarb(this.challengeContainer, this.state.challengePrompt);
    }

    if (this.state.challengePrompt.kind === "word_search") {
      renderWordSearchBarb(this.challengeContainer, this.state.challengePrompt);
    }

    if (this.state.challengePrompt.kind === "short_text" && this.state.challengePrompt.answerFormat === "integer") {
      renderTimedMathBarb(this.challengeContainer, this.state.challengePrompt);
    }

    if (
      this.state.challengePrompt.kind === "short_text" &&
      this.state.challengePrompt.answerFormat === "hex_digest"
    ) {
      renderHashValueBarb(this.challengeContainer, responseData.barbContext);
    }

    if (responseData.barbContext?.challengeType === "randomness_audit") {
      renderRandomnessAuditBarb(this.challengeContainer, responseData.barbContext);
    }

    if (responseData.barbContext?.challengeType === "code_error") {
      renderCodeErrorBarb(this.challengeContainer, responseData.barbContext);
    }

    if (this.state.challengePrompt.kind === "chess_puzzle") {
      renderChessPuzzleBarb(this.challengeContainer, responseData.barbContext);
    }

    await waitFor(BARB_HOLD_DURATION_MS);
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

  finishDemoVerification(responseData) {
    this.state.verified = true;
    this.state.resultToken = null;
    this.state.resultTokenExpiresAt = null;
    clearStoredVerification();
    this.showSuccessMessage(responseData.verdict === "robot" ? "Demo passed. No security code issued." : "Demo completed.");
    this.subtitleElement.textContent = "Demo complete";
    this.statusElement.classList.add("hidden");
    this.checkbox.checked = true;
    this.verifyButton.disabled = true;
    this.clearCountdownTimer();
    this.applyVisualState();
  }

  storeVerificationToken(resultToken, expiresAt) {
    this.state.resultToken = resultToken ?? null;
    this.state.resultTokenExpiresAt = expiresAt ?? null;
    persistVerificationToken(this.state.resultToken, this.state.resultTokenExpiresAt, this.getCurrentAttemptNumber());
  }

  showSuccessMessage(message) {
    this.resultElement.textContent = message;
    this.resultElement.classList.remove("hidden", "widget-result-error", "widget-result-barb");
    this.resultElement.classList.add("widget-result-success");
  }

  showErrorMessage(message) {
    this.resultElement.textContent = message;
    this.resultElement.classList.remove("hidden", "widget-result-success", "widget-result-barb");
    this.resultElement.classList.add("widget-result-error");
  }

  showBarbMessage(message) {
    this.resultElement.replaceChildren(createBarbMessageFragment(message));
    this.resultElement.classList.remove("hidden", "widget-result-success", "widget-result-error");
    this.resultElement.classList.add("widget-result-barb");
  }

  hideResultMessage() {
    this.resultElement.classList.add("hidden");
    this.resultElement.classList.remove("widget-result-success", "widget-result-error", "widget-result-barb");
    this.resultElement.textContent = "";
  }

  updateProgressBar() {
    this.progressBarElement.style.width = `${getProgressPercentage(
      this.state.successfulChallenges,
      this.state.requiredChallengesToPass,
    )}%`;
    this.renderProgressSegments();
  }

  renderProgressSegments() {
    if (!this.progressSegmentsElement) {
      return;
    }

    const segments = getProgressSegmentStates(
      this.state.successfulChallenges,
      this.state.requiredChallengesToPass,
    );
    this.progressSegmentsElement.style.setProperty("--widget-progress-segments", String(segments.length));
    this.progressSegmentsElement.innerHTML = segments
      .map((isFilled) => `<span class="${isFilled ? "is-filled" : ""}"></span>`)
      .join("");
  }

  handleChallengeClick(event) {
    const wordSearchCell = event.target.closest?.(".word-search-cell");
    if (wordSearchCell && this.challengeContainer.contains(wordSearchCell)) {
      this.selectWordSearchCell(wordSearchCell);
      this.renderApiPreview();
      return;
    }

    const pixelCell = event.target.closest?.(".pixel-cell");
    if (pixelCell && this.challengeContainer.contains(pixelCell)) {
      this.selectPixelCell(pixelCell);
      this.renderApiPreview();
      return;
    }

    const pointSurface = event.target.closest?.('[data-role="point-click-surface"]');
    if (pointSurface && this.challengeContainer.contains(pointSurface)) {
      this.togglePointSelection(event, pointSurface);
      this.renderApiPreview();
    }
  }

  handleChallengeHover(event) {
    const wordSearchCell = event.target.closest?.(".word-search-cell");
    if (!wordSearchCell || !this.challengeContainer.contains(wordSearchCell)) {
      clearWordSearchPreview(this.challengeContainer);
      return;
    }

    this.previewWordSearchLine(wordSearchCell);
  }

  selectWordSearchCell(wordSearchCell) {
    const prompt = this.state.challengePrompt;
    if (!prompt || prompt.kind !== "word_search") {
      return;
    }

    const gridElement = this.challengeContainer.querySelector('[data-role="word-search-grid"]');
    const answerInput = this.challengeContainer.querySelector("#widget-word-locations");
    if (!gridElement || !answerInput) {
      return;
    }

    const point = readGridPointFromDataset(wordSearchCell.dataset);
    if (!point) {
      return;
    }

    const pendingPoint = readGridPointFromDataset({
      row: gridElement.dataset.pendingRow,
      column: gridElement.dataset.pendingColumn,
    });

    if (!pendingPoint) {
      setWordSearchPendingCell(gridElement, wordSearchCell, point);
      renderWordSearchPreview(this.challengeContainer, prompt, point, point);
      return;
    }

    clearWordSearchPendingCell(gridElement);
    clearWordSearchPreview(this.challengeContainer);
    const line = getWordSearchLine(prompt, pendingPoint, point);
    if (!line) {
      return;
    }

    const matchedWord = prompt.words.find((word) => {
      const normalizedWord = normalizeWordSearchWord(word);
      return normalizedWord === line.word || normalizedWord === line.reversedWord;
    });

    if (!matchedWord) {
      return;
    }

    const locations = readWordSearchLocations(answerInput).filter(
      (location) => normalizeWordSearchWord(location.word) !== normalizeWordSearchWord(matchedWord),
    );
    locations.push({
      word: normalizeWordSearchWord(matchedWord),
      start: pendingPoint,
      end: point,
    });
    answerInput.value = JSON.stringify(locations);
    renderWordSearchSelections(this.challengeContainer, prompt, locations);
  }

  previewWordSearchLine(wordSearchCell) {
    const prompt = this.state.challengePrompt;
    if (!prompt || prompt.kind !== "word_search") {
      return;
    }

    const gridElement = this.challengeContainer.querySelector('[data-role="word-search-grid"]');
    if (!gridElement) {
      return;
    }

    const pendingPoint = readGridPointFromDataset({
      row: gridElement.dataset.pendingRow,
      column: gridElement.dataset.pendingColumn,
    });
    const hoverPoint = readGridPointFromDataset(wordSearchCell.dataset);

    if (!pendingPoint || !hoverPoint) {
      clearWordSearchPreview(this.challengeContainer);
      return;
    }

    renderWordSearchPreview(this.challengeContainer, prompt, pendingPoint, hoverPoint);
  }

  selectPixelCell(pixelCell) {
    const row = Number(pixelCell.dataset.row);
    const column = Number(pixelCell.dataset.column);
    if (!Number.isSafeInteger(row) || !Number.isSafeInteger(column)) {
      return;
    }

    this.challengeContainer
      .querySelectorAll(".pixel-cell.is-selected")
      .forEach((cell) => cell.classList.remove("is-selected"));
    pixelCell.classList.add("is-selected");

    const pointInput = this.challengeContainer.querySelector("#widget-grid-point");
    if (pointInput) {
      pointInput.value = JSON.stringify({ row, column });
    }
  }

  togglePointSelection(event, pointSurface) {
    const pointsInput = this.challengeContainer.querySelector("#widget-coordinate-points");
    if (!pointsInput || !this.state.challengePrompt) {
      return;
    }

    const rect = pointSurface.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const prompt = this.state.challengePrompt;
    const point = {
      x: Math.round(((event.clientX - rect.left) / rect.width) * prompt.width),
      y: Math.round(((event.clientY - rect.top) / rect.height) * prompt.height),
    };
    const existingPoints = readPointInput(pointsInput);
    const nearbyIndex = existingPoints.findIndex((existingPoint) => {
      const deltaX = existingPoint.x - point.x;
      const deltaY = existingPoint.y - point.y;
      return Math.sqrt(deltaX * deltaX + deltaY * deltaY) <= 10;
    });

    if (nearbyIndex >= 0) {
      existingPoints.splice(nearbyIndex, 1);
    } else {
      existingPoints.push(point);
    }

    pointsInput.value = JSON.stringify(existingPoints);
    renderSelectedPointMarkers(pointSurface, existingPoints, prompt);
    const statusElement = this.challengeContainer.querySelector('[data-role="coordinate-selection-status"]');
    if (statusElement) {
      statusElement.textContent = `${existingPoints.length} selected`;
    }
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
    if (!this.state.deadlineAt) {
      return;
    }

    this.state.countdownStartRemainingMs = Math.max(
      0,
      new Date(this.state.deadlineAt).getTime() - Date.now(),
    );
    this.updateCountdownTimer();
    this.scheduleCountdownTimerFrame();
  }

  updateCountdownTimer() {
    if (!this.state.deadlineAt) {
      this.timerElement.textContent = "";
      resetPageCountdownEffect();
      return;
    }

    const countdown = formatRemainingSeconds(this.state.deadlineAt, Date.now());
    if (this.timerElement.textContent !== countdown.label) {
      this.timerElement.textContent = countdown.label;
    }
    this.syncCountdownPageEffect(countdown.remainingMs);

    if (countdown.remainingMs <= 0) {
      this.clearCountdownTimer({ resetPageEffect: false });
    }
  }

  scheduleCountdownTimerFrame() {
    if (!this.state.deadlineAt || this.state.timerId) {
      return;
    }

    this.state.timerId = window.requestAnimationFrame(() => {
      this.state.timerId = null;
      this.updateCountdownTimer();

      if (this.state.deadlineAt && this.state.countdownStartRemainingMs !== null) {
        this.scheduleCountdownTimerFrame();
      }
    });
  }

  syncCountdownPageEffect(remainingMs) {
    setPageCountdownEffect(
      getCountdownPressureProgress(remainingMs, this.state.countdownStartRemainingMs),
    );
  }

  clearCountdownTimer({ resetPageEffect = true } = {}) {
    if (this.state.timerId) {
      window.cancelAnimationFrame(this.state.timerId);
      this.state.timerId = null;
    }

    this.state.countdownStartRemainingMs = null;

    if (resetPageEffect) {
      resetPageCountdownEffect();
    }
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

  resetApiPreview() {
    this.state.startExchange = null;
    this.state.submitResponse = undefined;
    if (this.apiPreviewBodyElement) {
      this.apiPreviewBodyElement.innerHTML = "";
    }
    this.apiPreviewElement?.classList.add("hidden");
  }

  recordStartExchange(requestBody, responseBody) {
    if (!this.state.isDemo) {
      return;
    }

    this.state.startExchange = {
      title: "Start challenge",
      method: "POST",
      url: this.getChallengeStartUrl(),
      requestBody,
      responseBody,
    };
    this.state.submitResponse = undefined;
    this.renderApiPreview();
  }

  recordSubmitExchange(requestBody, responseBody) {
    if (!this.state.isDemo) {
      return;
    }

    this.state.lastSubmitRequestBody = requestBody;
    this.state.submitResponse = responseBody;
    this.renderApiPreview();
  }

  renderApiPreview() {
    if (!this.state.isDemo || !this.apiPreviewElement || !this.apiPreviewBodyElement) {
      return;
    }

    const exchanges = [];
    if (this.state.startExchange) {
      exchanges.push(formatApiExchange(this.state.startExchange));
    }

    if (this.state.sessionId) {
      const requestBody =
        this.state.submitResponse !== undefined
          ? this.state.lastSubmitRequestBody
          : createSubmitChallengeRequestBody(
              this.state.sessionId,
              getAnswerForPrompt(this, this.state.challengePrompt),
            );
      exchanges.push(
        formatApiExchange({
          title: "Submit answer",
          method: "POST",
          url: this.getChallengeSubmitUrl(),
          requestBody,
          responseBody: this.state.submitResponse,
        }),
      );
    }

    this.apiPreviewBodyElement.innerHTML = exchanges.join("");
    this.apiPreviewElement.classList.toggle("hidden", exchanges.length === 0);
  }

  getCurrentAttemptNumber() {
    return this.state.attemptFailures + 1;
  }

  dispatchVerificationPassedEvent() {
    this.dispatchEvent(
      new CustomEvent("robot-verification-passed", {
        bubbles: true,
        detail: {
          resultToken: this.state.resultToken,
          expiresAt: this.state.resultTokenExpiresAt,
          attemptNumber: this.getCurrentAttemptNumber(),
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

function persistVerificationToken(resultToken, expiresAt, attemptNumber) {
  if (!resultToken || !expiresAt) {
    clearStoredVerification();
    return;
  }

  window.localStorage.setItem(
    VERIFICATION_STORAGE_KEY,
    JSON.stringify({
      resultToken,
      expiresAt,
      attemptNumber,
    }),
  );
}

function clearStoredVerification() {
  window.localStorage.removeItem(VERIFICATION_STORAGE_KEY);
}

function setPageCountdownEffect(progress) {
  if (typeof document === "undefined") {
    return;
  }

  const clampedProgress = Math.min(1, Math.max(0, progress));
  document.documentElement.style.setProperty(
    PAGE_COUNTDOWN_DARKNESS_VAR,
    (clampedProgress * MAX_PAGE_COUNTDOWN_DARKNESS).toFixed(3),
  );
  document.documentElement.style.setProperty(
    PAGE_COUNTDOWN_VIGNETTE_VAR,
    (clampedProgress * MAX_PAGE_COUNTDOWN_VIGNETTE).toFixed(3),
  );
}

function resetPageCountdownEffect() {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.style.removeProperty(PAGE_COUNTDOWN_DARKNESS_VAR);
  document.documentElement.style.removeProperty(PAGE_COUNTDOWN_VIGNETTE_VAR);
}

function readPointInput(pointsInput) {
  try {
    const points = JSON.parse(pointsInput.value || "[]");
    if (!Array.isArray(points)) {
      return [];
    }

    return points.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  } catch {
    return [];
  }
}

function renderSelectedPointMarkers(pointSurface, points, prompt) {
  pointSurface.querySelectorAll(".selected-point-marker").forEach((marker) => marker.remove());
  for (const point of points) {
    const marker = document.createElement("span");
    marker.className = "selected-point-marker";
    marker.dataset.x = String(point.x);
    marker.dataset.y = String(point.y);
    marker.style.left = `${(point.x / prompt.width) * 100}%`;
    marker.style.top = `${(point.y / prompt.height) * 100}%`;
    marker.setAttribute("aria-hidden", "true");
    pointSurface.append(marker);
  }
}

function renderPointClickBarb(container, prompt) {
  const pointSurface = container.querySelector('[data-role="point-click-surface"]');
  const pointsInput = container.querySelector("#widget-coordinate-points");
  if (!pointSurface || !pointsInput) {
    return;
  }

  const selectedPoints = readPointInput(pointsInput);
  const hitRadius = 24;
  const selectedTargetIndexes = new Set();

  for (const point of selectedPoints) {
    const targetIndex = prompt.items.findIndex(
      (item, index) =>
        item.kind === "tick" &&
        !selectedTargetIndexes.has(index) &&
        getPointDistance(point, item) <= hitRadius,
    );

    if (targetIndex >= 0) {
      selectedTargetIndexes.add(targetIndex);
    }
  }

  prompt.items.forEach((item, index) => {
    if (item.kind !== "tick" || selectedTargetIndexes.has(index)) {
      return;
    }

    const missedTick = pointSurface.querySelector(`[data-item-id="${cssAttributeEscape(item.id)}"]`);
    missedTick?.classList.add("point-item-bad-missed");
  });

  for (const point of selectedPoints) {
    const isWhiff = prompt.items
      .filter((item) => item.kind === "tick")
      .every((item) => getPointDistance(point, item) > hitRadius);

    if (isWhiff) {
      const marker = pointSurface.querySelector(
        `.selected-point-marker[data-x="${point.x}"][data-y="${point.y}"]`,
      );
      marker?.classList.add("selected-point-marker-whiff");
      spawnConfusedFace(pointSurface, point, prompt);
    }
  }
}

function renderWordSearchBarb(container, prompt) {
  const answerInput = container.querySelector("#widget-word-locations");
  const submittedLocations = readWordSearchLocations(answerInput);
  const foundWords = new Set();

  container.querySelectorAll(".word-search-cell.is-missed-word").forEach((cell) => {
    cell.classList.remove("is-missed-word");
  });

  for (const location of submittedLocations) {
    const line = getWordSearchLine(prompt, location.start, location.end);
    if (!line) {
      continue;
    }

    const submittedWord = normalizeWordSearchWord(location.word);
    if (submittedWord === line.word || submittedWord === line.reversedWord) {
      foundWords.add(submittedWord);
    }
  }

  for (const word of prompt.words) {
    const normalizedWord = normalizeWordSearchWord(word);
    if (foundWords.has(normalizedWord)) {
      continue;
    }

    const missingLine = findWordSearchLineForWord(prompt, normalizedWord);
    for (const point of missingLine?.points ?? []) {
      const cell = container.querySelector(
        `.word-search-cell[data-row="${point.row}"][data-column="${point.column}"]`,
      );
      cell?.classList.add("is-missed-word");
    }
  }
}

function renderTimedMathBarb(container, prompt) {
  const input = container.querySelector("#widget-answer-input");
  const challengeBlock = container.querySelector(".challenge-block");
  const expressionParts = getTimedMathExpressionParts(prompt);
  const expectedAnswer = evaluateTimedMathExpressionParts(expressionParts);

  if (!challengeBlock || expressionParts.length === 0 || expectedAnswer === null) {
    return;
  }

  container.querySelector(".timed-math-barb")?.remove();

  const submittedAnswer = input?.value?.trim() || "no answer";
  const audit = document.createElement("div");
  audit.className = "timed-math-barb";
  audit.setAttribute("aria-live", "polite");
  audit.append(createTimedMathExpressionElement(expressionParts));

  const comparison = document.createElement("div");
  comparison.className = "timed-math-comparison";
  comparison.append(createTimedMathValueElement("Submitted", submittedAnswer, "is-submitted"));
  const operator = document.createElement("span");
  operator.className = "timed-math-operator";
  operator.textContent = "!=";
  comparison.append(operator);
  comparison.append(createTimedMathValueElement("Expected", String(expectedAnswer), "is-expected"));
  audit.append(comparison);

  challengeBlock.append(audit);
  window.setTimeout(() => {
    audit.classList.add("is-answer-revealed");
  }, 650);
}

function createTimedMathExpressionElement(expressionParts) {
  const expression = document.createElement("div");
  expression.className = "timed-math-expression";

  for (const part of expressionParts) {
    const token = document.createElement("span");
    token.className = Number.isFinite(Number(part)) ? "timed-math-token is-number" : "timed-math-token is-operator";
    token.textContent = part;
    expression.append(token);
  }

  return expression;
}

function createTimedMathValueElement(label, value, className) {
  const wrapper = document.createElement("span");
  wrapper.className = `timed-math-value ${className}`;

  const labelElement = document.createElement("span");
  labelElement.className = "timed-math-value-label";
  labelElement.textContent = label;
  wrapper.append(labelElement);

  const valueElement = document.createElement("strong");
  valueElement.textContent = value;
  wrapper.append(valueElement);

  return wrapper;
}

function getTimedMathExpressionParts(prompt) {
  if (Array.isArray(prompt.mathExpressionParts) && prompt.mathExpressionParts.length > 0) {
    return prompt.mathExpressionParts.map((part) => String(part));
  }

  const bodyMatch = String(prompt.body ?? "").match(/(-?\d+)\s*([*+-])\s*(-?\d+)\s*([*+-])\s*(-?\d+)/);
  return bodyMatch ? bodyMatch.slice(1) : [];
}

function evaluateTimedMathExpressionParts(parts) {
  if (parts.length !== 5) {
    return null;
  }

  const firstValue = Number(parts[0]);
  const firstOperator = parts[1];
  const secondValue = Number(parts[2]);
  const secondOperator = parts[3];
  const thirdValue = Number(parts[4]);

  if (!Number.isFinite(firstValue) || !Number.isFinite(secondValue) || !Number.isFinite(thirdValue)) {
    return null;
  }

  const firstResult = applyTimedMathOperator(firstValue, firstOperator, secondValue);
  return firstResult === null ? null : applyTimedMathOperator(firstResult, secondOperator, thirdValue);
}

function applyTimedMathOperator(leftValue, operator, rightValue) {
  if (operator === "*") {
    return leftValue * rightValue;
  }

  if (operator === "+") {
    return leftValue + rightValue;
  }

  if (operator === "-") {
    return leftValue - rightValue;
  }

  return null;
}

function renderHashValueBarb(container, barbContext) {
  const context = normalizeHashValueBarbContext(barbContext);
  if (!context) {
    return;
  }

  container.querySelectorAll(".hash-value-barb").forEach((element) => element.remove());
  const comparison = document.createElement("div");
  comparison.className = "hash-value-barb";
  comparison.setAttribute("aria-label", "Hash digest comparison");

  const submittedRow = createDigestComparisonRow("Submitted", context.submittedDigest, context);
  const expectedRow = createDigestComparisonRow("Expected", context.expectedDigest, context);
  comparison.append(submittedRow, expectedRow);

  if (context.submittedDigest.length !== context.expectedDigest.length) {
    const count = document.createElement("p");
    count.className = "hash-value-count";
    count.textContent = `Submitted ${context.submittedDigest.length} characters; expected ${context.expectedDigest.length}.`;
    comparison.append(count);
  }

  const challengeBlock = container.querySelector(".challenge-block") ?? container;
  challengeBlock.append(comparison);
}

function renderChessPuzzleBarb(container, barbContext) {
  if (!barbContext || barbContext.type !== "chess_puzzle") {
    return;
  }

  const stage = container.querySelector('[data-role="chess-barb-stage"]');
  const answerInput = container.querySelector("#widget-answer-input");
  if (!stage) {
    return;
  }

  const submittedMove = String(barbContext.submittedMove ?? answerInput?.value?.trim() ?? "").trim();
  const expectedSan = String(barbContext.expectedSan ?? "").trim();
  stage.replaceChildren();

  if (submittedMove) {
    const ghostMove = document.createElement("span");
    ghostMove.className = "chess-ghost-move";
    ghostMove.textContent = submittedMove;
    stage.append(ghostMove);
  }

  if (barbContext.malformed) {
    answerInput?.classList.add("chess-answer-input-bad");
    const invalidNote = document.createElement("span");
    invalidNote.className = "chess-invalid-note";
    invalidNote.textContent = "invalid notation";
    stage.append(invalidNote);
  }

  if (expectedSan) {
    const bestMove = document.createElement("span");
    bestMove.className = "chess-best-move-reveal";
    bestMove.textContent = `best move: ${expectedSan}`;
    stage.append(bestMove);
  }
}

function normalizeHashValueBarbContext(barbContext) {
  if (!barbContext || barbContext.type !== "hash_value") {
    return null;
  }

  const submittedDigest = String(barbContext.submittedDigest ?? "");
  const expectedDigest = String(barbContext.expectedDigest ?? "");
  const firstMismatchIndex = Number(barbContext.firstMismatchIndex);

  return {
    submittedDigest,
    expectedDigest,
    firstMismatchIndex: Number.isSafeInteger(firstMismatchIndex) ? firstMismatchIndex : getFirstDigestMismatchIndex(submittedDigest, expectedDigest),
  };
}

function createDigestComparisonRow(label, digest, context) {
  const row = document.createElement("div");
  row.className = "hash-value-row";

  const labelElement = document.createElement("span");
  labelElement.className = "hash-value-label";
  labelElement.textContent = label;

  const valueElement = document.createElement("code");
  valueElement.className = "hash-value-digest";
  appendDigestWindow(valueElement, digest, context.firstMismatchIndex, Math.max(context.submittedDigest.length, context.expectedDigest.length));

  row.append(labelElement, valueElement);
  return row;
}

function appendDigestWindow(valueElement, digest, firstMismatchIndex, comparisonLength) {
  const windowRadius = 10;
  const focusIndex = firstMismatchIndex >= 0 ? firstMismatchIndex : 0;
  const start = Math.max(0, focusIndex - windowRadius);
  const end = Math.min(comparisonLength, focusIndex + windowRadius + 1);

  if (start > 0) {
    valueElement.append(createDigestEllipsis());
  }

  for (let index = start; index < end; index += 1) {
    const character = digest[index] ?? "-";
    const characterElement = document.createElement("span");
    characterElement.textContent = character;
    if (index === firstMismatchIndex) {
      characterElement.className = "hash-value-mismatch";
    }
    valueElement.append(characterElement);
  }

  if (end < comparisonLength) {
    valueElement.append(createDigestEllipsis());
  }
}

function createDigestEllipsis() {
  const ellipsis = document.createElement("span");
  ellipsis.className = "hash-value-ellipsis";
  ellipsis.textContent = "...";
  return ellipsis;
}

function getFirstDigestMismatchIndex(submittedDigest, expectedDigest) {
  const maxLength = Math.max(submittedDigest.length, expectedDigest.length);

  for (let index = 0; index < maxLength; index += 1) {
    if (submittedDigest[index] !== expectedDigest[index]) {
      return index;
    }
  }

  return -1;
}

function renderRandomnessAuditBarb(container, barbContext) {
  const submittedChoice = findChoiceElement(container, barbContext?.submittedChoiceId);
  const expectedChoice = findChoiceElement(container, barbContext?.expectedChoiceId);

  if (submittedChoice && submittedChoice !== expectedChoice) {
    submittedChoice.classList.add("choice-card-human-pattern");
    const codeElement = submittedChoice.querySelector("code");
    if (hasRepeatedBitRun(codeElement?.textContent ?? "")) {
      codeElement?.classList.add("choice-bits-repeated-run");
    }
  }

  if (expectedChoice) {
    window.setTimeout(() => {
      expectedChoice.classList.add("choice-card-correct-reveal");
    }, Math.floor(BARB_ANIMATION_DURATION_MS * 0.42));
  }
}

function renderCodeErrorBarb(container, barbContext) {
  const selectedChoice = container.querySelector('input[name="widget-answer-choice"]:checked')?.closest?.(
    ".choice-card, .choice-line",
  );
  const expectedChoice = findChoiceElement(container, barbContext?.expectedChoiceId);

  if (selectedChoice && selectedChoice !== expectedChoice) {
    selectedChoice.classList.add("choice-code-error-wrong");
  }

  container.querySelectorAll(".choice-card, .choice-line").forEach((choiceElement) => {
    if (choiceElement !== expectedChoice && choiceElement !== selectedChoice) {
      choiceElement.classList.add("choice-code-error-dimmed");
    }
  });

  if (expectedChoice) {
    window.setTimeout(() => {
      expectedChoice.classList.add("choice-code-error-correct");
    }, Math.floor(BARB_ANIMATION_DURATION_MS * 0.42));
  }
}

function findChoiceElement(container, choiceId) {
  if (!choiceId) {
    return null;
  }

  const escapedChoiceId = cssAttributeEscape(choiceId);
  return container.querySelector(
    `.choice-card[data-choice-id="${escapedChoiceId}"], .choice-line[data-choice-id="${escapedChoiceId}"]`,
  );
}

function hasRepeatedBitRun(value) {
  return /([01])\1{2,}|(0101|1010)/.test(value);
}

function spawnConfusedFace(pointSurface, point, prompt) {
  const face = document.createElement("span");
  face.className = "confused-face-marker";
  face.textContent = "🤨";
  face.style.left = `${(point.x / prompt.width) * 100}%`;
  face.style.top = `${(point.y / prompt.height) * 100}%`;
  face.setAttribute("aria-hidden", "true");
  pointSurface.append(face);
}

function getPointDistance(firstPoint, secondPoint) {
  const deltaX = firstPoint.x - secondPoint.x;
  const deltaY = firstPoint.y - secondPoint.y;
  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
}

function createBarbMessageFragment(message) {
  const fragment = document.createDocumentFragment();
  const hexPattern = /#[0-9A-Fa-f]{6}/g;
  let lastIndex = 0;

  for (const match of message.matchAll(hexPattern)) {
    if (match.index > lastIndex) {
      fragment.append(document.createTextNode(message.slice(lastIndex, match.index)));
    }

    const token = document.createElement("code");
    token.className = "barb-color-token";
    token.style.color = match[0];
    token.textContent = match[0].toUpperCase();
    fragment.append(token);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < message.length) {
    fragment.append(document.createTextNode(message.slice(lastIndex)));
  }

  return fragment;
}

function cssAttributeEscape(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function waitFor(durationMs) {
  return new Promise((resolve) => window.setTimeout(resolve, durationMs));
}

function readGridPointFromDataset(dataset) {
  const row = Number(dataset?.row);
  const column = Number(dataset?.column);
  if (!Number.isSafeInteger(row) || !Number.isSafeInteger(column)) {
    return null;
  }

  return { row, column };
}

function setWordSearchPendingCell(gridElement, wordSearchCell, point) {
  clearWordSearchPendingCell(gridElement);
  gridElement.dataset.pendingRow = String(point.row);
  gridElement.dataset.pendingColumn = String(point.column);
  wordSearchCell.classList.add("is-pending");
}

function clearWordSearchPendingCell(gridElement) {
  delete gridElement.dataset.pendingRow;
  delete gridElement.dataset.pendingColumn;
  gridElement.querySelectorAll(".word-search-cell.is-pending").forEach((cell) => {
    cell.classList.remove("is-pending");
  });
}

function clearWordSearchPreview(container) {
  container.querySelectorAll(".word-search-cell.is-preview").forEach((cell) => {
    cell.classList.remove("is-preview");
  });
}

function renderWordSearchPreview(container, prompt, start, end) {
  clearWordSearchPreview(container);
  const line = getWordSearchLine(prompt, start, end);
  if (!line) {
    return;
  }

  for (const point of line.points) {
    const cell = container.querySelector(
      `.word-search-cell[data-row="${point.row}"][data-column="${point.column}"]`,
    );
    cell?.classList.add("is-preview");
  }
}

function readWordSearchLocations(answerInput) {
  try {
    const locations = JSON.parse(answerInput.value || "[]");
    if (!Array.isArray(locations)) {
      return [];
    }

    return locations
      .map((location) => ({
        word: normalizeWordSearchWord(location?.word),
        start: parseWordSearchPoint(location?.start),
        end: parseWordSearchPoint(location?.end),
      }))
      .filter((location) => location.word && location.start && location.end);
  } catch {
    return [];
  }
}

function parseWordSearchPoint(point) {
  const row = Number(point?.row);
  const column = Number(point?.column);
  if (!Number.isSafeInteger(row) || !Number.isSafeInteger(column)) {
    return null;
  }

  return { row, column };
}

function renderWordSearchSelections(container, prompt, locations) {
  container.querySelectorAll(".word-search-cell.is-found").forEach((cell) => {
    cell.classList.remove("is-found");
  });
  container.querySelectorAll(".word-search-word.is-found").forEach((wordElement) => {
    wordElement.classList.remove("is-found");
  });

  for (const location of locations) {
    const line = getWordSearchLine(prompt, location.start, location.end);
    if (!line) {
      continue;
    }

    for (const point of line.points) {
      const cell = container.querySelector(
        `.word-search-cell[data-row="${point.row}"][data-column="${point.column}"]`,
      );
      cell?.classList.add("is-found");
    }

    for (const wordElement of container.querySelectorAll(".word-search-word")) {
      if (normalizeWordSearchWord(wordElement.dataset.word) === normalizeWordSearchWord(location.word)) {
        wordElement.classList.add("is-found");
      }
    }
  }

  const statusElement = container.querySelector('[data-role="word-search-selection-status"]');
  if (statusElement) {
    statusElement.textContent = `${locations.length}/${prompt.words.length} found`;
  }
}

function findWordSearchLineForWord(prompt, word) {
  const directions = [
    { row: -1, column: -1 },
    { row: -1, column: 0 },
    { row: -1, column: 1 },
    { row: 0, column: -1 },
    { row: 0, column: 1 },
    { row: 1, column: -1 },
    { row: 1, column: 0 },
    { row: 1, column: 1 },
  ];

  for (let row = 0; row < prompt.grid.length; row += 1) {
    const columnCount = prompt.grid[row]?.length ?? 0;
    for (let column = 0; column < columnCount; column += 1) {
      for (const direction of directions) {
        const end = {
          row: row + direction.row * (word.length - 1),
          column: column + direction.column * (word.length - 1),
        };
        const line = getWordSearchLine(prompt, { row, column }, end);
        if (line?.word === word) {
          return line;
        }
      }
    }
  }

  return null;
}

function getWordSearchLine(prompt, start, end) {
  const rowDelta = end.row - start.row;
  const columnDelta = end.column - start.column;
  if (rowDelta === 0 && columnDelta === 0) {
    return null;
  }

  const isStraight = rowDelta === 0 || columnDelta === 0 || Math.abs(rowDelta) === Math.abs(columnDelta);
  if (!isStraight) {
    return null;
  }

  const rowStep = Math.sign(rowDelta);
  const columnStep = Math.sign(columnDelta);
  const length = Math.max(Math.abs(rowDelta), Math.abs(columnDelta)) + 1;
  const points = [];
  let word = "";

  for (let index = 0; index < length; index += 1) {
    const row = start.row + rowStep * index;
    const column = start.column + columnStep * index;
    const letter = prompt.grid[row]?.[column];
    if (!letter) {
      return null;
    }

    points.push({ row, column });
    word += letter;
  }

  return {
    points,
    word: normalizeWordSearchWord(word),
    reversedWord: normalizeWordSearchWord(Array.from(word).reverse().join("")),
  };
}

function normalizeWordSearchWord(value) {
  return String(value ?? "").trim().toUpperCase();
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
