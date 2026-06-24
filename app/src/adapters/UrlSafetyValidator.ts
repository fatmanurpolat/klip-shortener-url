import { validateUrl } from '../security/urlSafety';
import { UrlValidator, Logger } from '../ports';

/** UrlValidator adapter delegating to the existing validateUrl (throws UrlSafetyError). */
export function createUrlSafetyValidator(): UrlValidator {
  return { validate: (url: string, log: Logger) => validateUrl(url, log) };
}
