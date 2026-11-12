/**
 * Phase 0 unit tests (no database).
 * Run: pnpm test
 */
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { loginLockedUntil, recordLoginFailure, recordLoginSuccess, resetLoginLimiter } from "./rateLimit";
import { csrfProtection, CSRF_COOKIE, CSRF_HEADER } from "./csrf";
import { generateTotpSecret, totpCode, verifyTotp, base32Decode, base32Encode } from "./totp";
import { hashPassword, comparePasswords, newPasswordSchema } from "./passwords";
import { apiErrorFormat, errorBody } from "./errors";

describe("login lockout", () => {
  beforeEach(() => resetLoginLimiter());

  test("5 failures in 15 min lock the username and IP for 15 min", () => {
    const t0 = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 4; i++) {
      assert.equal(recordLoginFailure("1.1.1.1", "ali", t0 + i * 1000), false);
      assert.equal(loginLockedUntil("1.1.1.1", "ali", t0 + i * 1000), null);
    }
    assert.equal(recordLoginFailure("1.1.1.1", "ali", t0 + 5000), true);
    const until = loginLockedUntil("1.1.1.1", "ali", t0 + 6000);
    assert.equal(until, t0 + 5000 + 15 * 60 * 1000);
    // Same username from another IP is locked too (username bucket)...
    assert.ok(loginLockedUntil("9.9.9.9", "ALI ", t0 + 6000));
    // ...and the IP is locked for other usernames (IP bucket).
    assert.ok(loginLockedUntil("1.1.1.1", "sara", t0 + 6000));
    // Lock expires after 15 minutes.
    assert.equal(loginLockedUntil("1.1.1.1", "ali", t0 + 5000 + 15 * 60 * 1000 + 1), null);
  });

  test("failures older than the window don't count", () => {
    const t0 = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 4; i++) recordLoginFailure("2.2.2.2", "omar", t0 + i);
    assert.equal(recordLoginFailure("2.2.2.2", "omar", t0 + 16 * 60 * 1000), false);
  });

  test("a successful login clears the username bucket", () => {
    const t0 = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 4; i++) recordLoginFailure("3.3.3.3", "zara", t0 + i);
    recordLoginSuccess("zara");
    assert.equal(recordLoginFailure("4.4.4.4", "zara", t0 + 10), false);
  });
});

describe("CSRF double-submit", () => {
  const app = express();
  app.use(express.json());
  app.use(apiErrorFormat);
  app.use(csrfProtection);
  app.get("/api/ping", (_req, res) => res.json({ ok: true }));
  app.post("/api/thing", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  after(() => server.close());

  const getToken = async () => {
    const res = await fetch(`${base}/api/ping`);
    const setCookie = res.headers.get("set-cookie") || "";
    const token = new RegExp(`${CSRF_COOKIE}=([a-f0-9]{64})`).exec(setCookie)?.[1];
    assert.ok(token, "GET sets the CSRF cookie");
    return token!;
  };

  test("POST without cookie/header is rejected (403 CSRF_INVALID)", async () => {
    const res = await fetch(`${base}/api/thing`, { method: "POST" });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, "CSRF_INVALID");
  });

  test("POST with cookie but no header is rejected", async () => {
    const token = await getToken();
    const res = await fetch(`${base}/api/thing`, { method: "POST", headers: { cookie: `${CSRF_COOKIE}=${token}` } });
    assert.equal(res.status, 403);
  });

  test("POST with a mismatched header is rejected", async () => {
    const token = await getToken();
    const res = await fetch(`${base}/api/thing`, { method: "POST", headers: { cookie: `${CSRF_COOKIE}=${token}`, [CSRF_HEADER]: "a".repeat(64) } });
    assert.equal(res.status, 403);
  });

  test("POST with matching cookie + header passes", async () => {
    const token = await getToken();
    const res = await fetch(`${base}/api/thing`, { method: "POST", headers: { cookie: `${CSRF_COOKIE}=${token}`, [CSRF_HEADER]: token } });
    assert.equal(res.status, 200);
  });
});

describe("TOTP", () => {
  test("RFC 6238 test vector (SHA-1, T=59s)", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    assert.equal(totpCode(secret, 59_000).slice(-6), "287082");
  });
  test("accepts ±1 step, rejects older codes and junk", () => {
    const secret = generateTotpSecret();
    const now = Date.UTC(2026, 5, 1, 12, 0, 0);
    assert.ok(verifyTotp(secret, totpCode(secret, now), now));
    assert.ok(verifyTotp(secret, totpCode(secret, now - 30_000), now));
    assert.ok(!verifyTotp(secret, totpCode(secret, now - 90_000), now));
    assert.ok(!verifyTotp(secret, "abcdef", now));
    assert.deepEqual(base32Decode(base32Encode(Buffer.from("pixely"))), Buffer.from("pixely"));
  });
});

describe("passwords", () => {
  test("hash/compare round trip and wrong password", async () => {
    const hash = await hashPassword("correct horse 42");
    assert.ok(await comparePasswords("correct horse 42", hash));
    assert.ok(!(await comparePasswords("wrong", hash)));
    assert.ok(!(await comparePasswords("x", "not-a-hash")));
  });
  test("new-password policy", () => {
    assert.ok(!newPasswordSchema.safeParse("short1").success);
    assert.ok(!newPasswordSchema.safeParse("onlyletterslong").success);
    assert.ok(newPasswordSchema.safeParse("letters-and-1-number").success);
  });
});

describe("error format", () => {
  test("5xx never leaks the message", () => {
    const body = errorBody(500, "relation \"users\" does not exist");
    assert.equal(body.error.code, "SERVER_ERROR");
    assert.ok(!body.error.message.includes("relation"));
  });
});
