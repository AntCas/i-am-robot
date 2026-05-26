const formElement = document.querySelector('[data-role="register-form"]');
const submitButton = document.querySelector('[data-role="submit-button"]');
const formStatusElement = document.querySelector('[data-role="form-status"]');
const resultCardElement = document.querySelector('[data-role="result-card"]');
const embedCodeElement = document.querySelector('[data-role="embed-code"]');
const siteSecretElement = document.querySelector('[data-role="site-secret"]');
const copyStatusElement = document.querySelector('[data-role="copy-status"]');
const copySecretStatusElement = document.querySelector('[data-role="copy-secret-status"]');
const copySurfaceElements = Array.from(document.querySelectorAll('[data-role="copy-surface"]'));
const languageTabElements = Array.from(document.querySelectorAll('[data-role="language-tab"]'));
const languagePanelElements = Array.from(document.querySelectorAll('[data-role="language-panel"]'));
const embedCodePlaceholder = "Generate embed code in Step 1 to fill this in.";

if (formElement && submitButton && formStatusElement && resultCardElement && embedCodeElement) {
  formElement.addEventListener("submit", (event) => {
    event.preventDefault();
    void registerSite();
  });
}

copySurfaceElements.forEach((copySurfaceElement) => {
  copySurfaceElement.addEventListener("click", () => {
    void copySurfaceContent(copySurfaceElement);
  });

  copySurfaceElement.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    void copySurfaceContent(copySurfaceElement);
  });
});

languageTabElements.forEach((tabElement) => {
  tabElement.addEventListener("click", () => {
    selectLanguageExample(tabElement.dataset.languageGroup, tabElement.dataset.language);
  });
});

async function registerSite() {
  const formData = new FormData(formElement);
  const hostname = String(formData.get("hostname") ?? "").trim();

  submitButton.disabled = true;
  setCopySurfaceDisabled("embed-code", true);
  setCopySurfaceDisabled("site-secret", true);
  setStatus(formStatusElement, "Generating embed code...", false);
  setStatus(copyStatusElement, "", false);
  setStatus(copySecretStatusElement, "", false);
  embedCodeElement.textContent = embedCodePlaceholder;
  if (siteSecretElement) {
    siteSecretElement.value = "";
  }

  try {
    const response = await fetch(`${window.location.origin}/im-a-robot/api/sites/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hostname,
      }),
    });

    const responseData = await response.json();
    if (!response.ok || !responseData.success) {
      setStatus(formStatusElement, getRegistrationErrorMessage(responseData.error), true);
      return;
    }

    embedCodeElement.textContent = responseData.embedCode;
    if (siteSecretElement) {
      siteSecretElement.value = responseData.secret ?? "";
    }
    setCopySurfaceDisabled("embed-code", false);
    setCopySurfaceDisabled("site-secret", !responseData.secret);
    setStatus(formStatusElement, "Embed code generated. Copy the snippet below.", false);
  } catch (error) {
    setStatus(formStatusElement, String(error), true);
  } finally {
    submitButton.disabled = false;
  }
}

async function copySurfaceContent(copySurfaceElement) {
  const statusElement = getCopyStatusElement(copySurfaceElement);
  const copyText = getCopySurfaceText(copySurfaceElement);

  if (copySurfaceElement.dataset.copyDisabled === "true" || !copyText) {
    setStatus(statusElement, copySurfaceElement.dataset.copyEmpty ?? "Nothing to copy yet.", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(copyText);
    setStatus(statusElement, copySurfaceElement.dataset.copySuccess ?? "Copied.", false);
  } catch {
    selectCopySurfaceText(copySurfaceElement);
    setStatus(statusElement, "Select and copy manually.", true);
  }
}

function getCopySurfaceText(copySurfaceElement) {
  const sourceRole = copySurfaceElement.dataset.copySource;
  const sourceElement = sourceRole ? document.querySelector(`[data-role="${sourceRole}"]`) : null;
  if (sourceElement && "value" in sourceElement) {
    return sourceElement.value.trim();
  }

  return copySurfaceElement.querySelector("code")?.textContent.trim() ?? "";
}

function getCopyStatusElement(copySurfaceElement) {
  const statusRole = copySurfaceElement.dataset.copyStatus;
  return statusRole ? document.querySelector(`[data-role="${statusRole}"]`) : null;
}

function selectCopySurfaceText(copySurfaceElement) {
  const sourceRole = copySurfaceElement.dataset.copySource;
  const sourceElement = sourceRole ? document.querySelector(`[data-role="${sourceRole}"]`) : null;
  if (sourceElement && "select" in sourceElement) {
    sourceElement.focus();
    sourceElement.select();
    return;
  }

  const textElement = sourceElement ?? copySurfaceElement.querySelector("code");
  if (textElement) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textElement);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}

function setCopySurfaceDisabled(sourceRole, isDisabled) {
  copySurfaceElements.forEach((copySurfaceElement) => {
    if (copySurfaceElement.dataset.copySource === sourceRole) {
      copySurfaceElement.dataset.copyDisabled = String(isDisabled);
    }
  });
}

function setStatus(element, message, isError) {
  if (!element) {
    return;
  }

  element.textContent = message;
  element.classList.toggle("register-form-status-error", Boolean(isError) && Boolean(message));
}

function selectLanguageExample(group, language) {
  if (!group || !language) {
    return;
  }

  languageTabElements.forEach((tabElement) => {
    if (tabElement.dataset.languageGroup !== group) {
      return;
    }

    const isSelected = tabElement.dataset.language === language;
    tabElement.classList.toggle("is-active", isSelected);
    tabElement.setAttribute("aria-selected", String(isSelected));
  });

  languagePanelElements.forEach((panelElement) => {
    if (panelElement.dataset.languageGroup !== group) {
      return;
    }

    panelElement.classList.toggle("hidden", panelElement.dataset.language !== language);
  });
}

function getRegistrationErrorMessage(errorCode) {
  const messages = {
    invalid_hostname: "Enter a valid website hostname.",
  };

  return messages[errorCode] ?? "Could not generate embed code.";
}
