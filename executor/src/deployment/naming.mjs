const MAX_SLUG_LENGTH = 40;

const SAFE_SLUG =
  /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const PROJECT_LABEL_KEY = "project";
export const JOB_LABEL_KEY = "job";

export function safeSlug(input) {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();

  if (!trimmed) {
    return null;
  }

  // Tolak input yang dapat mengontrol path atau memuat control characters.
  if (
    trimmed.includes("\0") ||
    /[\n\r]/.test(trimmed) ||
    /\.\./.test(trimmed) ||
    /[/\\]/.test(trimmed)
  ) {
    return null;
  }

  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-|-$/g, "");

  if (!slug || !SAFE_SLUG.test(slug)) {
    return null;
  }

  return slug;
}

export function containerName(slug) {
  return `nexdeploy-${slug}-app`;
}

export function networkName(slug) {
  return `nexdeploy-${slug}-network`;
}

export function imageName(
  slug,
  tag = "release",
) {
  const safeTag =
    typeof tag === "string" &&
    /^[a-zA-Z0-9_.-]+$/.test(tag)
      ? tag
      : "release";

  return `nexdeploy/${slug}:${safeTag}`;
}

export function label(
  key,
  value,
) {
  if (
    typeof key !== "string" ||
    !/^[a-zA-Z0-9_.-]+$/.test(key)
  ) {
    throw new Error(
      `Nama label tidak aman: ${String(key).slice(0, 80)}`,
    );
  }

  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    throw new Error(
      "Nilai label tidak valid.",
    );
  }

  return `nexdeploy.${key}=${value}`;
}