/**
 * Compare two semver versions
 * Returns true if newVersion > currentVersion
 * Handles variable-length versions (1.2, 1.2.3, 1.2.3.4, etc.)
 */
export function isNewerVersion(currentVersion: string, newVersion: string): boolean {
  // Remove any pre-release tags (e.g., -alpha.0, -beta.1)
  const cleanCurrent = currentVersion.split("-")[0];
  const cleanNew = newVersion.split("-")[0];

  // Split and validate numeric parts
  const currentParts = cleanCurrent.split(".").map((part) => {
    const num = Number(part);
    if (isNaN(num) || !part.trim()) {
      throw new Error(`Invalid version format: ${currentVersion}`);
    }
    return num;
  });

  const newerParts = cleanNew.split(".").map((part) => {
    const num = Number(part);
    if (isNaN(num) || !part.trim()) {
      throw new Error(`Invalid version format: ${newVersion}`);
    }
    return num;
  });

  // Compare up to the maximum length, treating missing parts as 0
  const maxLength = Math.max(currentParts.length, newerParts.length);

  for (let i = 0; i < maxLength; i++) {
    const currentPart = currentParts[i] || 0;
    const newerPart = newerParts[i] || 0;

    if (newerPart > currentPart) return true;
    if (newerPart < currentPart) return false;
  }

  // If base versions are equal, check pre-release tags
  // A version with no pre-release tag is considered newer than one with a tag
  const currentHasPrerelease = currentVersion.includes("-");
  const newHasPrerelease = newVersion.includes("-");

  if (!currentHasPrerelease && newHasPrerelease) {
    return false; // Current stable is newer than new pre-release
  }

  if (currentHasPrerelease && !newHasPrerelease) {
    return true; // New stable is newer than current pre-release
  }

  return false;
}
