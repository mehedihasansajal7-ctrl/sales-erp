/**
 * Startup guard (runs once when the server boots, before the first request).
 *
 * In production the app refuses to start with a weak or missing AUTH_SECRET: that
 * secret signs every session cookie, so a guessable value would let anybody forge
 * an admin session. The same check catches a missing DATABASE_URL early instead of
 * failing on the first page load.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;

  const secret = process.env.AUTH_SECRET ?? "";
  const placeholders = [
    "change-me-in-production-please-use-a-long-random-string",
    "dev-only-secret-change-me-please-0123456789abcdef",
  ];

  if (secret.length < 32) {
    throw new Error(
      "AUTH_SECRET must be set to at least 32 random characters in production (openssl rand -base64 48).",
    );
  }
  if (placeholders.includes(secret)) {
    throw new Error(
      "AUTH_SECRET is still the development placeholder. Generate a real secret before starting in production.",
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
}
