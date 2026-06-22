import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export so the nginx box can serve the landing page as plain files
  // (matches the repo's `nginx serves ./web` model — no extra Node service).
  output: "export",
  trailingSlash: true,
  // Static export can't use the on-the-fly image optimizer.
  images: { unoptimized: true },
  // The repo has lockfiles at both / and web/landing; pin this app as the
  // workspace root so Next stops warning and traces from here.
  outputFileTracingRoot: __dirname,
  // Emit to web/landing/out by default; deploy step copies it under web/.
};

export default nextConfig;
