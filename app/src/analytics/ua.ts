import { UAParser } from 'ua-parser-js';
import { Crawlers } from 'ua-parser-js/extensions';

/**
 * User-Agent parsing. Uses ua-parser-js with the Crawlers extension so bots are
 * detected (ua-parser-js flags them as browser.type === 'crawler').
 */

export interface UAInfo {
  browser: string; // e.g. "Chrome", "Safari", "Firefox"
  os: string; // e.g. "iOS", "Android", "macOS", "Windows"
  device: string; // "mobile" | "desktop" | "tablet" | "bot"
}

export function parseUA(ua: string): UAInfo {
  const result = new UAParser(ua ?? '', Crawlers).getResult();

  const browser = result.browser.name ?? '';
  const os = result.os.name ?? '';

  const browserType = (result.browser as { type?: string }).type;
  const deviceType = result.device.type;

  let device: string;
  if (browserType === 'crawler') device = 'bot';
  else if (deviceType === 'mobile') device = 'mobile';
  else if (deviceType === 'tablet') device = 'tablet';
  else device = 'desktop';

  return { browser, os, device };
}
