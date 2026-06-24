const APP_BASE_PATH = "/im-a-robot";

const listElement = document.querySelector('[data-role="challenge-bank-list"]');
const statusElement = document.querySelector('[data-role="challenge-bank-status"]');

if (listElement) {
  loadChallengeBank();
}

async function loadChallengeBank() {
  try {
    const response = await fetch(`${window.location.origin}${APP_BASE_PATH}/api/challenge/types`);
    if (!response.ok) {
      throw new Error("catalog_unavailable");
    }

    const catalog = await response.json();
    const challenges = Array.isArray(catalog.challenges) ? catalog.challenges : [];
    const challengeTypes = challenges
      .map((challenge) => challenge?.type)
      .filter((type) => typeof type === "string" && type.length > 0);

    if (challengeTypes.length === 0) {
      throw new Error("empty_catalog");
    }

    listElement.replaceChildren(...challengeTypes.map(createChallengeListItem));
    setStatus(`${challengeTypes.length} challenges`);
  } catch {
    setStatus("Showing fallback challenge list.");
  }
}

function createChallengeListItem(challengeType) {
  const item = document.createElement("li");
  const link = document.createElement("a");
  link.className = "challenge-bank-link";
  link.href = `${APP_BASE_PATH}/?challenge=${encodeURIComponent(challengeType)}`;
  link.textContent = challengeType;
  item.append(link);
  return item;
}

function setStatus(message) {
  if (statusElement) {
    statusElement.textContent = message;
  }
}
