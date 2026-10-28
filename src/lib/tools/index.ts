/**
 * Agent tools: web_search, fetch_url, calc, vault_lookup, file tools.
 * Contracts per rule 40; implemented in phases 20-60.
 */
export type ToolName =
  | "web_search"
  | "fetch_url"
  | "calc"
  | "vault_lookup"
  | "list_files"
  | "read_file"
  | "write_file"
  | "append_file"
  | "delete_file"
  | "export_csv"
  | "export_zip";
