// Port: destination-URL safety validation.

/** Minimal logger shape — satisfied by Fastify's `request.log` and `console`. */
export type Logger = {
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export interface UrlValidator {
  /**
   * Resolves void if the URL is safe to shorten; THROWS `UrlSafetyError` (from
   * security/urlSafety) on a disallowed destination. `log` carries fail-open
   * warnings (e.g. Safe Browsing unavailable).
   */
  validate(url: string, log: Logger): Promise<void>;
}
