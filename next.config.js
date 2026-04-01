/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    outputFileTracingIncludes: {
      "/*": [
        "./exports/universal-archetype-side-models-live.json",
        "./exports/universal-archetype-side-models-2025-10-23-to-2026-03-09-v16-bench-split.json",
        "./exports/universal-live-calibration.json",
        "./exports/universal-live-projection-distribution.json",
        "./exports/universal-live-qualification-settings.json",
        "./exports/live-pra-raw-feature-live.json",
        "./exports/projection-backtest-allplayers-with-rows-live.json",
        "./exports/projection-backtest-allplayers-with-rows-2025-10-23-to-2026-03-09.json",
      ],
    },
  },
};

module.exports = nextConfig;
