import { checkDatabaseHealth } from "../repositories/health.repository";

export const loader = async () => {
  try {
    await checkDatabaseHealth();
    return Response.json(
      { status: "ok", database: "reachable" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "error", database: "unreachable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
};
