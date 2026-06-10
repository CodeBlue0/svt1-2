import { createClient } from "@supabase/supabase-js";

const BOOTED = new Set();

export async function bootLegacyDashboard(page) {
  if (BOOTED.has(page)) return;
  BOOTED.add(page);

  window.supabase = { createClient };

  await import("../supabase-config.js");
  await import("../../total-results/supabase-data.js");

  if (page === "index") {
    await import("../../total-results/app.js");
    await import("../../total-results/items.js");
    return;
  }

  if (page === "items") {
    await import("../../total-results/items.js");
    return;
  }

  if (page === "insights") {
    await import("../../total-results/insights.js");
  }
}
