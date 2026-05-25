import type { ChallengeCatalogEntry, ChallengeDefinition } from "../types.ts";
import { challengeDefinitions } from "./index.ts";
import { resolveChallengeTimeLimitMs } from "./shared.ts";

export function getChallengeCatalog(): ChallengeCatalogEntry[] {
	return challengeDefinitions.map(createChallengeCatalogEntry);
}

function createChallengeCatalogEntry(challengeDefinition: ChallengeDefinition): ChallengeCatalogEntry {
	const { example, responseFormat, timeLimitMs } = challengeDefinition.catalog;

	return {
		type: challengeDefinition.type,
		promptKind: example.prompt.kind,
		answerFormat: example.prompt.answerFormat,
		responseFormat,
		example,
		timeLimitMs: resolveChallengeTimeLimitMs(timeLimitMs),
	};
}
