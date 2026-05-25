const formElement = document.querySelector('[data-role="register-form"]');
const submitButton = document.querySelector('[data-role="submit-button"]');
const formStatusElement = document.querySelector('[data-role="form-status"]');
const resultCardElement = document.querySelector('[data-role="result-card"]');
const resultSummaryElement = document.querySelector('[data-role="result-summary"]');
const embedCodeElement = document.querySelector('[data-role="embed-code"]');
const copyButton = document.querySelector('[data-role="copy-button"]');
const copyStatusElement = document.querySelector('[data-role="copy-status"]');

if (formElement && submitButton && formStatusElement && resultCardElement && resultSummaryElement && embedCodeElement) {
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

async function registerSite() {
  const formData = new FormData(formElement);
  const siteKey = String(formData.get("siteKey") ?? "").trim();
  const hostname = String(formData.get("hostname") ?? "").trim();

  submitButton.disabled = true;
  setStatus(formStatusElement, "Creating site key...", false);
  setStatus(copyStatusElement, "", false);

  try {
    const response = await fetch(`${window.location.origin}/im-a-robot/api/sites/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteKey,
        hostname,
      }),
    });

    const responseData = await response.json();
    if (!response.ok || !responseData.success) {
      setStatus(formStatusElement, getRegistrationErrorMessage(responseData.error), true);
      return;
    }

    embedCodeElement.value = responseData.embedCode;
    resultSummaryElement.textContent = `Site key "${responseData.siteKey}" is registered for ${responseData.hostname}.`;
    resultCardElement.classList.remove("hidden");
    setStatus(formStatusElement, "Site key created. Copy the snippet below.", false);
  } catch (error) {
    setStatus(formStatusElement, String(error), true);
  } finally {
    submitButton.disabled = false;
  }
}

async function copyEmbedCode() {
  const embedCode = embedCodeElement.value;
  if (!embedCode) {
    setStatus(copyStatusElement, "Create a site key first.", true);
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

function getRegistrationErrorMessage(errorCode) {
  const messages = {
    invalid_site_key: "Choose a site key with letters, numbers, underscores, or dashes.",
    invalid_hostname: "Enter a valid website hostname.",
    site_key_taken: "That site key is already in use.",
  };

  return messages[errorCode] ?? "Could not create the site key.";
}
