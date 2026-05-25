const formElement = document.querySelector('[data-role="register-form"]');
const submitButton = document.querySelector('[data-role="submit-button"]');
const formStatusElement = document.querySelector('[data-role="form-status"]');
const resultCardElement = document.querySelector('[data-role="result-card"]');
const embedCodeElement = document.querySelector('[data-role="embed-code"]');
const copyButton = document.querySelector('[data-role="copy-button"]');
const copyStatusElement = document.querySelector('[data-role="copy-status"]');
const languageTabElements = Array.from(document.querySelectorAll('[data-role="language-tab"]'));
const languagePanelElements = Array.from(document.querySelectorAll('[data-role="language-panel"]'));

if (formElement && submitButton && formStatusElement && resultCardElement && embedCodeElement) {
  formElement.addEventListener("submit", (event) => {
    event.preventDefault();
    void registerSite();
  });
}

if (copyButton && embedCodeElement && copyStatusElement) {
  copyButton.addEventListener("click", () => {
    void copyEmbedCode();
  });
}

languageTabElements.forEach((tabElement) => {
  tabElement.addEventListener("click", () => {
    selectLanguageExample(tabElement.dataset.languageGroup, tabElement.dataset.language);
  });
});

async function registerSite() {
  const formData = new FormData(formElement);
  const hostname = String(formData.get("hostname") ?? "").trim();

  submitButton.disabled = true;
  setStatus(formStatusElement, "Generating embed code...", false);
  setStatus(copyStatusElement, "", false);

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

    embedCodeElement.value = responseData.embedCode;
    copyButton.disabled = false;
    setStatus(formStatusElement, "Embed code generated. Copy the snippet below.", false);
  } catch (error) {
    setStatus(formStatusElement, String(error), true);
  } finally {
    submitButton.disabled = false;
  }
}

async function copyEmbedCode() {
  const embedCode = embedCodeElement.value;
  if (!embedCode) {
    setStatus(copyStatusElement, "Generate embed code first.", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(embedCode);
    setStatus(copyStatusElement, "Embed code copied.", false);
  } catch {
    embedCodeElement.focus();
    embedCodeElement.select();
    setStatus(copyStatusElement, "Select and copy the code manually.", true);
  }
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
