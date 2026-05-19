# compta/ — DEPRECATED (sera supprimé)

Ce dossier contenait l'ancien serveur MCP standalone (stdio) qui s'exécutait via `tsx` en local.

**Il est désormais déprécié et sera supprimé.** Les tools MCP sont servis directement par la webapp Baloo via la route HTTP `/api/mcp` (Streamable HTTP transport + OAuth 2.0).

Pour utiliser le MCP, voir : [../doc/integrations.md](../doc/integrations.md) section "MCP HTTP".

Suppression effective : Phase 1 du pivot V1 ([../doc/plans/2026-05-18-baloo-miroir-mcp-first-phase-1.md](../doc/plans/2026-05-18-baloo-miroir-mcp-first-phase-1.md), Task 4).
