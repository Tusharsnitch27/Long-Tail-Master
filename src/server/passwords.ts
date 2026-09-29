import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt$N$r$p$salt$hash (base64url). Parameters are stored so they can be raised later without breaking old hashes.
const N = 16384, R = 8, P = 1, KEYLEN = 64;

const derive = (password: string, salt: Buffer, n: number, r: number, p: number) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined) {
  if (!stored) return false;
  const [algo, n, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await derive(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export const PASSWORD_RULE = "at least 8 characters";
export const validPassword = (p: string) => typeof p === "string" && p.length >= 8 && p.length <= 200;
export const validUsername = (u: string) => /^[a-z0-9._-]{3,40}$/.test(u);
