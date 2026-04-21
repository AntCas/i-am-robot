class RobotCheckWidget extends HTMLElement {
  connectedCallback() {
    if (this.dataset.rendered === "true") {
      return;
    }

    this.dataset.rendered = "true";
    this.innerHTML = `
      <div class="widget-card">
        <div class="widget-main">
          <label class="widget-checkbox" for="challenge-toggle">
            <input id="challenge-toggle" type="checkbox">
            <span class="fake-check"></span>
          </label>

          <div class="widget-copy">
            <p class="widget-title">I'm a robot</p>
            <p class="widget-subtitle">Timed challenge verification</p>
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
      </div>
    `;
  }
}

customElements.define("robot-check-widget", RobotCheckWidget);
