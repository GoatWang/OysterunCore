export const OYSTERUN_UPDATE_CHANNEL_LATEST = "latest";
export const OYSTERUN_UPDATE_CHANNEL_BETA = "beta";

function parseSemver(value) {
  const match = String(value || "")
    .trim()
    .match(
      /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
    );
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrereleaseIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    return leftNumber === rightNumber ? 0 : leftNumber > rightNumber ? 1 : -1;
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left === right ? 0 : left > right ? 1 : -1;
}

export function compareOysterunSemver(leftValue, rightValue) {
  const left = parseSemver(leftValue);
  const right = parseSemver(rightValue);
  if (!left || !right) return null;

  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] === right.core[index]) continue;
    return left.core[index] > right.core[index] ? 1 : -1;
  }

  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const comparison = comparePrereleaseIdentifier(leftIdentifier, rightIdentifier);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

export function isOysterunPrereleaseVersion(value) {
  const parsed = parseSemver(value);
  return Boolean(parsed && parsed.prerelease.length > 0);
}

export function classifyOysterunBetaVersion({ currentVersion, betaVersion }) {
  if (!isOysterunPrereleaseVersion(betaVersion)) {
    return {
      relation: "invalid",
      install_available: false,
    };
  }
  const comparison = compareOysterunSemver(betaVersion, currentVersion);
  if (comparison === null) {
    return {
      relation: "invalid",
      install_available: false,
    };
  }
  if (comparison > 0) {
    return {
      relation: "newer",
      install_available: true,
    };
  }
  if (comparison === 0) {
    return {
      relation: "installed",
      install_available: false,
    };
  }
  return {
    relation: "older",
    install_available: false,
  };
}
