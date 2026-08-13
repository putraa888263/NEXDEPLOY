const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
function base64ToBytes(value: string) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }

async function encryptionKey() {
  const material = await crypto.subtle.digest("SHA-256", encoder.encode("nexdeploy-local-environment-v1"));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptEnvironmentValue(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), encoder.encode(value));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptEnvironmentValue(value: string) {
  const [iv, encrypted] = value.split(".");
  if (!iv || !encrypted) throw new Error("Environment value tidak dapat dibaca.");
  const result = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, await encryptionKey(), base64ToBytes(encrypted));
  return decoder.decode(result);
}

export function isSecretKey(key: string) {
  return /(?:PASSWORD|SECRET|TOKEN|KEY|PRIVATE|CREDENTIAL)/i.test(key);
}
