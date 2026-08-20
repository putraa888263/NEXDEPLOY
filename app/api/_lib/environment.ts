const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(value: Uint8Array) {
  return btoa(
    String.fromCharCode(...value),
  );
}

function base64ToBytes(value: string) {
  return Uint8Array.from(
    atob(value),
    (character) =>
      character.charCodeAt(0),
  );
}

async function encryptionKey() {
  const value =
    process.env.NEXDEPLOY_ENCRYPTION_KEY ||
    "nexdeploy-local-environment-v1";

  const material =
    await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(value),
    );

  return crypto.subtle.importKey(
    "raw",
    material,
    "AES-GCM",
    false,
    [
      "encrypt",
      "decrypt",
    ],
  );
}

export async function encryptEnvironmentValue(
  value: string,
) {
  const iv =
    crypto.getRandomValues(
      new Uint8Array(12),
    );

  const encrypted =
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
      },
      await encryptionKey(),
      encoder.encode(value),
    );

  return `${bytesToBase64(iv)}.${bytesToBase64(
    new Uint8Array(encrypted),
  )}`;
}

export async function decryptEnvironmentValue(
  value: string,
) {
  const [
    iv,
    encrypted,
  ] =
    value.split(".");

  if (
    !iv ||
    !encrypted
  ) {
    throw new Error(
      "Environment value tidak dapat dibaca.",
    );
  }

  const result =
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv:
          base64ToBytes(iv),
      },
      await encryptionKey(),
      base64ToBytes(encrypted),
    );

  return decoder.decode(result);
}

export const PROTECTED_ENVIRONMENT_KEYS =
  new Set([
    "APP_KEY",
    "DB_CONNECTION",
    "DB_HOST",
    "DB_PORT",
    "DB_DATABASE",
    "DB_USERNAME",
    "DB_PASSWORD",
  ]);

export function isProtectedEnvironmentKey(
  key: string,
) {
  return PROTECTED_ENVIRONMENT_KEYS.has(
    key,
  );
}

export function isSecretKey(
  key: string,
) {
  return /(?:PASSWORD|SECRET|TOKEN|KEY|PRIVATE|CREDENTIAL)/i.test(
    key,
  );
}
