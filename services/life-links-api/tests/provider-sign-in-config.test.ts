import { describe, expect, it } from "vitest";
import { readProviderSignInConfig } from "../src/provider-sign-in-config.js";

const origin = "https://lifelinks.example.test";
const google = {
  LIFE_LINKS_SIGN_IN_PROVIDERS: "google",
  LIFE_LINKS_SIGN_IN_GOOGLE_CLIENT_ID: "synthetic-client",
  LIFE_LINKS_SIGN_IN_GOOGLE_CLIENT_SECRET: "synthetic-private-value",
  LIFE_LINKS_SIGN_IN_GOOGLE_REDIRECT_URI: origin + "/api/auth/providers/google/callback"
};

describe("LifeLinks provider sign-in configuration", () => {
  it("needs no credentials for disabled providers and returns only explicitly enabled providers", () => {
    expect(readProviderSignInConfig({}, "http://localhost:3000")).toEqual([]);
    expect(readProviderSignInConfig({ ...google, LIFE_LINKS_SIGN_IN_MICROSOFT_CLIENT_SECRET: "unused" }, origin))
      .toEqual([{ id: "google", clientId: "synthetic-client", clientSecret: "synthetic-private-value",
        redirectUri: google.LIFE_LINKS_SIGN_IN_GOOGLE_REDIRECT_URI }]);
  });
  it("rejects unknown, duplicate or incomplete configuration without exposing values", () => {
    for (const env of [
      { LIFE_LINKS_SIGN_IN_PROVIDERS: "instagram" },
      { ...google, LIFE_LINKS_SIGN_IN_PROVIDERS: "google,google" },
      { ...google, LIFE_LINKS_SIGN_IN_GOOGLE_CLIENT_SECRET: "" }
    ]) {
      expect(() => readProviderSignInConfig(env, origin)).toThrow();
      try { readProviderSignInConfig(env, origin); } catch (error) {
        expect(String(error)).not.toContain("synthetic-private-value");
        expect(String(error)).not.toContain("synthetic-client");
      }
    }
  });
  it("binds callbacks to the exact product HTTPS origin and provider", () => {
    for (const uri of ["https://other.example.test/api/auth/providers/google/callback",
      origin + "/api/auth/providers/microsoft/callback", google.LIFE_LINKS_SIGN_IN_GOOGLE_REDIRECT_URI + "?next=x",
      "http://lifelinks.example.test/api/auth/providers/google/callback"]) {
      expect(() => readProviderSignInConfig({ ...google, LIFE_LINKS_SIGN_IN_GOOGLE_REDIRECT_URI: uri }, origin)).toThrow();
    }
    expect(() => readProviderSignInConfig({ ...google,
      LIFE_LINKS_SIGN_IN_GOOGLE_REDIRECT_URI: "http://localhost:3000/api/auth/providers/google/callback" }, "http://localhost:3000")).toThrow();
  });
  it("requires an approved ChatGPT client and its explicit token-authentication method", () => {
    const env = { LIFE_LINKS_SIGN_IN_PROVIDERS: "chatgpt", LIFE_LINKS_SIGN_IN_CHATGPT_CLIENT_ID: "synthetic-approved-client",
      LIFE_LINKS_SIGN_IN_CHATGPT_REDIRECT_URI: origin + "/api/auth/providers/chatgpt/callback",
      LIFE_LINKS_SIGN_IN_CHATGPT_TOKEN_AUTH_METHOD: "none" };
    expect(() => readProviderSignInConfig(env, origin)).toThrow(/approved/);
    expect(readProviderSignInConfig({ ...env, LIFE_LINKS_SIGN_IN_CHATGPT_APPROVED: "true" }, origin))
      .toMatchObject([{ id: "chatgpt", approved: true, tokenEndpointAuthMethod: "none" }]);
    expect(() => readProviderSignInConfig({ ...env, LIFE_LINKS_SIGN_IN_CHATGPT_APPROVED: "true",
      LIFE_LINKS_SIGN_IN_CHATGPT_TOKEN_AUTH_METHOD: "client_secret_basic" }, origin)).toThrow(/incomplete/);
  });
  it("keeps Microsoft audience and Meta API version explicit", () => {
    expect(readProviderSignInConfig({ LIFE_LINKS_SIGN_IN_PROVIDERS: "microsoft",
      LIFE_LINKS_SIGN_IN_MICROSOFT_CLIENT_ID: "synthetic-ms-client", LIFE_LINKS_SIGN_IN_MICROSOFT_CLIENT_SECRET: "synthetic-secret",
      LIFE_LINKS_SIGN_IN_MICROSOFT_REDIRECT_URI: origin + "/api/auth/providers/microsoft/callback",
      LIFE_LINKS_SIGN_IN_MICROSOFT_TENANT: "consumers" }, origin)).toMatchObject([{ id: "microsoft", tenant: "consumers" }]);
    expect(() => readProviderSignInConfig({ LIFE_LINKS_SIGN_IN_PROVIDERS: "facebook",
      LIFE_LINKS_SIGN_IN_FACEBOOK_CLIENT_ID: "synthetic-meta-client", LIFE_LINKS_SIGN_IN_FACEBOOK_CLIENT_SECRET: "synthetic-secret",
      LIFE_LINKS_SIGN_IN_FACEBOOK_REDIRECT_URI: origin + "/api/auth/providers/facebook/callback" }, origin)).toThrow(/incomplete/);
  });
});
