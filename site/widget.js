import {
  createInitialWidgetState,
  createStartChallengeRequestBody,
  createSubmitChallengeRequestBody,
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

    try {
      const response = await fetch(this.getChallengeStartUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createStartChallengeRequestBody(
            this.state.config.siteKey,
            this.state.config.hostname || window.location.host,
            this.state.verificationSessionId,
            this.getCurrentAttemptNumber(),
            this.state.config.demoChallenge,
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
      this.updateProgressBar();
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
      return;
    }

    const pixelCell = event.target.closest?.(".pixel-cell");
    if (pixelCell && this.challengeContainer.contains(pixelCell)) {
      this.selectPixelCell(pixelCell);
      return;
    }

    const pointSurface = event.target.closest?.('[data-role="point-click-surface"]');
    if (pointSurface && this.challengeContainer.contains(pointSurface)) {
      this.togglePointSelection(event, pointSurface);
    }
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
      return;
    }

    clearWordSearchPendingCell(gridElement);
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
    marker.style.left = `${(point.x / prompt.width) * 100}%`;
    marker.style.top = `${(point.y / prompt.height) * 100}%`;
    marker.setAttribute("aria-hidden", "true");
    pointSurface.append(marker);
  }
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
