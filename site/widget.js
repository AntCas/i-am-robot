class RobotCheckWidget extends HTMLElement {
  connectedCallback() {
    if (this.dataset.rendered === "true") {
      return;
    }

    this.dataset.rendered = "true";
    this.state = {
      appBasePath: this.detectAppBasePath(),
      sessionId: null,
      challengeType: null,
      deadlineAt: null,
      timerId: null,
    };

    this.innerHTML = `
      <div class="widget-card widget-card-interactive">
        <div class="widget-main">
          <label class="widget-checkbox" for="challenge-toggle">
            <input id="challenge-toggle" type="checkbox">
            <span class="fake-check"></span>
          </label>

          <div class="widget-copy">
            <p class="widget-title" data-role="widget-title">I'm a robot</p>
            <p class="widget-subtitle" data-role="widget-subtitle">No humans allowed</p>
          </div>
        </div>

        <div class="widget-brand">
          <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 52 52" role="presentation" aria-hidden="true">
              <g class="robot-icon" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <path class="robot-gray" d="M20 10h12" />
                <path class="robot-blue" d="M26 6v4" />
                <rect class="robot-gray" x="14" y="14" width="24" height="18" rx="6" />
                <circle class="robot-blue" cx="21" cy="23" r="2.5" />
                <circle class="robot-blue" cx="31" cy="23" r="2.5" />
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

    this.checkbox = this.querySelector("#challenge-toggle");
    this.titleElement = this.querySelector('[data-role="widget-title"]');
    this.subtitleElement = this.querySelector('[data-role="widget-subtitle"]');
    this.expandedElement = this.querySelector('[data-role="widget-expanded"]');
    this.challengeContainer = this.querySelector('[data-role="challenge-container"]');
    this.verifyButton = this.querySelector('[data-role="verify-button"]');
    this.resultElement = this.querySelector('[data-role="result"]');
    this.metaElement = this.querySelector('[data-role="widget-meta"]');
    this.challengeTypeElement = this.querySelector('[data-role="challenge-type"]');
    this.timerElement = this.querySelector('[data-role="timer"]');

    this.checkbox.addEventListener("change", () => {
      if (this.checkbox.checked) {
        void this.activate();
      } else {
        this.reset();
      }
    });

    this.verifyButton.addEventListener("click", () => {
      void this.submitAnswer();
    });
  }

  disconnectedCallback() {
    this.clearTimer();
  }

  async activate() {
    this.titleElement.textContent = "Prove it";
    this.subtitleElement.textContent = "Timed challenge verification";
    this.expandedElement.classList.remove("hidden");
    this.resultElement.classList.add("hidden");
    this.resultElement.textContent = "";
    this.verifyButton.disabled = true;
    this.challengeContainer.innerHTML = '<p class="muted">Loading challenge...</p>';

    try {
      const response = await fetch(`${window.location.origin}${this.state.appBasePath}/api/challenge/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteKey: "site_demo_123",
          hostname: window.location.host,
          mode: "prove_robot",
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.sessionId) {
        this.showError(data.error ? `Could not load challenge: ${data.error}` : "Could not load challenge.");
        return;
      }

      this.state.sessionId = data.sessionId;
      this.state.challengeType = data.challenge.type;
      this.state.deadlineAt = data.deadlineAt;
      this.renderChallenge(data.challenge.type, data.challenge.prompt);
      this.challengeTypeElement.textContent = data.challenge.type;
      this.metaElement.classList.remove("hidden");
      this.verifyButton.disabled = false;
      this.startTimer();
    } catch (error) {
      this.showError(String(error));
    }
  }

  reset() {
    this.clearTimer();
    this.state.sessionId = null;
    this.state.challengeType = null;
    this.state.deadlineAt = null;
    this.titleElement.textContent = "I'm a robot";
    this.subtitleElement.textContent = "No humans allowed";
    this.expandedElement.classList.add("hidden");
    this.metaElement.classList.add("hidden");
    this.challengeContainer.innerHTML = '<p class="muted">Check the box to load a challenge.</p>';
    this.resultElement.classList.add("hidden");
    this.resultElement.textContent = "";
    this.verifyButton.disabled = true;
  }

  async submitAnswer() {
    if (!this.state.sessionId) {
      return;
    }

    const answer = this.collectAnswer();
    if (!answer) {
      this.showError("Choose or enter an answer first.");
      return;
    }

    this.verifyButton.disabled = true;

    try {
      const response = await fetch(`${window.location.origin}${this.state.appBasePath}/api/challenge/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: this.state.sessionId,
          answer,
        }),
      });

      const data = await response.json();
      if (data.success) {
        this.showSuccess("Verified.");
      } else {
        this.showError(data.reason ? `Verification failed: ${data.reason}` : "Verification failed.");
      }
    } catch (error) {
      this.showError(String(error));
    } finally {
      this.verifyButton.disabled = false;
    }
  }

  renderChallenge(type, prompt) {
    if (type === "timed_math") {
      this.challengeContainer.innerHTML = `
        <div class="challenge-block">
          <p>${this.escapeHtml(prompt.question)}</p>
          <label>
            Answer
            <input type="text" id="widget-answer-input" autocomplete="off">
          </label>
        </div>
      `;
      return;
    }

    if (type === "randomness_audit") {
      this.challengeContainer.innerHTML = `
        <div class="challenge-block">
          <p>${this.escapeHtml(prompt.description)}</p>
          <div class="choice-grid">
            ${prompt.choices
              .map(
                (choice) => `
                  <label class="choice-card">
                    <input type="radio" name="widget-answer-choice" value="${this.escapeHtml(choice.label)}">
                    <strong>${this.escapeHtml(choice.label)}</strong>
                    <code>${this.escapeHtml(choice.bits)}</code>
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
      this.challengeContainer.innerHTML = `
        <div class="challenge-block">
          <p>${this.escapeHtml(prompt.description)}</p>
          <pre class="code-block">${this.escapeHtml(prompt.code)}</pre>
          <div class="choice-list">
            ${prompt.choices
              .map(
                (choice) => `
                  <label class="choice-line">
                    <input type="radio" name="widget-answer-choice" value="${this.escapeHtml(choice.value)}">
                    <span>${this.escapeHtml(choice.label)}</span>
                  </label>
                `,
              )
              .join("")}
          </div>
        </div>
      `;
    }
  }

  collectAnswer() {
    if (this.state.challengeType === "timed_math") {
      const input = this.querySelector("#widget-answer-input");
      return { value: input?.value?.trim() ?? "" };
    }

    const checked = this.querySelector('input[name="widget-answer-choice"]:checked');
    if (!checked) {
      return null;
    }

    return { value: checked.value };
  }

  showSuccess(message) {
    this.resultElement.textContent = message;
    this.resultElement.classList.remove("hidden");
    this.resultElement.classList.remove("widget-result-error");
    this.resultElement.classList.add("widget-result-success");
  }

  showError(message) {
    this.resultElement.textContent = message;
    this.resultElement.classList.remove("hidden");
    this.resultElement.classList.remove("widget-result-success");
    this.resultElement.classList.add("widget-result-error");
  }

  startTimer() {
    this.clearTimer();
    this.updateTimer();
    this.state.timerId = window.setInterval(() => this.updateTimer(), 200);
  }

  updateTimer() {
    if (!this.state.deadlineAt) {
      this.timerElement.textContent = "";
      return;
    }

    const remainingMs = new Date(this.state.deadlineAt).getTime() - Date.now();
    const remainingSeconds = Math.max(0, remainingMs / 1000);
    this.timerElement.textContent = `${remainingSeconds.toFixed(1)}s left`;

    if (remainingMs <= 0) {
      this.clearTimer();
    }
  }

  clearTimer() {
    if (this.state.timerId) {
      window.clearInterval(this.state.timerId);
      this.state.timerId = null;
    }
  }

  detectAppBasePath() {
    if (window.location.pathname === "/im-a-robot" || window.location.pathname.startsWith("/im-a-robot/")) {
      return "/im-a-robot";
    }

    return "";
  }

  escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}

customElements.define("robot-check-widget", RobotCheckWidget);
