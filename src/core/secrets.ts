import { Entry } from "@napi-rs/keyring";

const SERVICE = "meeting-notes";

export type SecretName = "claude" | "openai";

const ACCOUNTS: Record<SecretName, string> = {
  claude: "claude_api_key",
  openai: "openai_api_key",
};

export const SECRET_LABELS: Record<SecretName, string> = {
  claude: "Anthropic",
  openai: "OpenAI",
};

function entry(name: SecretName): Entry {
  return new Entry(SERVICE, ACCOUNTS[name]);
}

export async function getSecret(name: SecretName): Promise<string | null> {
  try {
    const v = entry(name).getPassword();
    return v ?? null;
  } catch {
    return null;
  }
}

export async function setSecret(name: SecretName, value: string): Promise<void> {
  entry(name).setPassword(value);
}

export async function deleteSecret(name: SecretName): Promise<void> {
  try {
    entry(name).deletePassword();
  } catch {
    // ignore — no entry to delete
  }
}

export async function hasSecret(name: SecretName): Promise<boolean> {
  return (await getSecret(name)) !== null;
}

export async function requireSecret(name: SecretName): Promise<string> {
  const v = await getSecret(name);
  if (!v) {
    throw new Error(
      `No ${SECRET_LABELS[name]} API key found in macOS Keychain. ` +
        `Run \`meeting-notes init\` or \`meeting-notes set-key ${name}\` to set one.`
    );
  }
  return v;
}
