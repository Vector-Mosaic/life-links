import { describe, expect, it } from "vitest";
import { providerButtonLabel, validateProviderAuthorizationUrl, type ProviderId } from "../src/client.js";

const examples: Record<ProviderId, string> = {
  google: "https://accounts.google.com/o/oauth2/v2/auth?client_id=example&state=transaction",
  microsoft: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=example",
  apple: "https://appleid.apple.com/auth/authorize?response_mode=form_post",
  facebook: "https://www.facebook.com/v24.0/dialog/oauth?client_id=123",
  github: "https://github.com/login/oauth/authorize?client_id=example",
  chatgpt: "https://auth.openai.com/api/accounts/authorize?client_id=oaiapp_example",
};

describe("browser provider actions", () => {
  it.each(Object.entries(examples))("accepts the normal %s authorization origin", (provider, url) => {
    expect(validateProviderAuthorizationUrl(provider as ProviderId, url)).toBe(url);
    expect(providerButtonLabel(provider as ProviderId)).toMatch(/^Continue with /u);
  });

  it.each([
    "javascript:alert('credential')",
    "http://accounts.google.com/o/oauth2/v2/auth",
    "https://accounts.google.com.attacker.example/o/oauth2/v2/auth",
    "https://attacker.accounts.google.com/o/oauth2/v2/auth",
    "https://accounts.google.com:444/o/oauth2/v2/auth",
    "https://client:secret@accounts.google.com/o/oauth2/v2/auth",
    "https://accounts.google.com/o/oauth2/v2/auth#credential",
    "https://attacker.example/?target=https://accounts.google.com",
    "https://accounts.google.com/o/oauth2/v2/auth\n",
    "/auth/google",
  ])("rejects an unsafe browser redirect without echoing it", (url) => {
    expect(() => validateProviderAuthorizationUrl("google", url)).toThrow("Provider sign-in could not be started.");
    try { validateProviderAuthorizationUrl("google", url); } catch (error) { expect(String(error)).not.toContain("credential"); }
  });

  it("rejects another provider's origin and unknown IDs including prototype names", () => {
    expect(() => validateProviderAuthorizationUrl("google", examples.github)).toThrow();
    expect(() => validateProviderAuthorizationUrl("constructor" as ProviderId, examples.google)).toThrow();
    expect(() => providerButtonLabel("toString" as ProviderId)).toThrow();
  });
});
