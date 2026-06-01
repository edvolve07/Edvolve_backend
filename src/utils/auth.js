import { randomBytes, randomUUID, scrypt as scryptAsync, timingSafeEqual } from "node:crypto";

export function validateEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function validatePassword(password) {
  return typeof password === "string" && password.length >= 8;
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await new Promise((resolve, reject) => {
    scryptAsync(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });

  return {
    salt,
    hash: derivedKey.toString("hex")
  };
}

export async function verifyPassword(password, salt, expectedHash) {
  const derivedKey = await new Promise((resolve, reject) => {
    scryptAsync(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });

  const expectedBuffer = Buffer.from(expectedHash, "hex");
  if (expectedBuffer.length !== derivedKey.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, derivedKey);
}

export function createAuthToken() {
  return randomUUID();
}
