// Stops the live site from being built in sample (demo) mode by accident. Netlify sets CONTEXT.
// While the public demo runs on the production site, set ALLOW_DEMO_IN_PRODUCTION=yes in Netlify's
// environment variables; remove it (and VITE_DATA_MODE) at go-live.
const ctx = process.env.CONTEXT;
const sample = process.env.VITE_DATA_MODE === "sample";
if (ctx === "production" && sample && process.env.ALLOW_DEMO_IN_PRODUCTION !== "yes") {
  console.error(
    "\nRefusing to build the production site in sample (demo) mode.\n" +
      "For go-live: remove VITE_DATA_MODE from Netlify's environment variables.\n" +
      "To keep running the public demo on this site for now: add ALLOW_DEMO_IN_PRODUCTION = yes.\n",
  );
  process.exit(1);
}
if (ctx === "production" && sample) console.warn("Building the production site in sample (demo) mode, as ALLOW_DEMO_IN_PRODUCTION allows.");
