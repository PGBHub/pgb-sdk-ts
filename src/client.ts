export interface PGBoxClientConfig {
  /** PGBox Cloud Endpoint URL (default: https://cloud.pgboxhub.com) */
  endpoint?: string;
  /** PGBox API Key or Access Token */
  apiKey?: string;
  /** Direct PostgreSQL Connection URL (optional for direct pooler connections) */
  dbUrl?: string;
  /** Database name target (default: postgres) */
  database?: string;
}

export interface ActionInvokeOptions {
  dryRun?: boolean;
}

export interface ActionResponse<T = unknown> {
  action: string;
  status: "completed" | "simulated" | "failed";
  dry_run: boolean;
  duration_ms: number;
  results: T;
  outbox_id?: number | null;
  message?: string;
}

export interface SchemaJson {
  version: string;
  database: string;
  tables: Record<string, {
    name: string;
    schema: string;
    type: string;
    description?: string;
    primary_keys: string[];
    columns: Array<{
      name: string;
      data_type: string;
      type_ts: string;
      nullable: boolean;
      default?: string;
      is_primary_key: boolean;
      is_foreign_key: boolean;
    }>;
  }>;
  relationships: Array<{
    source: string;
    target: string;
    type: string;
    constraint_name?: string;
  }>;
  actions: Record<string, {
    name: string;
    description?: string;
    input_schema?: Record<string, unknown>;
    output_schema?: Record<string, unknown>;
  }>;
}

export class PGBoxClient {
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly dbUrl?: string;
  readonly database: string;

  /** Dynamic actions proxy (e.g. pgbox.actions.approveOrder({ id: 1 })) */
  readonly actions: Record<string, (params?: Record<string, unknown>, opts?: ActionInvokeOptions) => Promise<ActionResponse>>;

  constructor(config: PGBoxClientConfig = {}) {
    this.endpoint = (config.endpoint || "https://cloud.pgboxhub.com").replace(/\/$/, "");
    this.apiKey = config.apiKey || (typeof process !== "undefined" ? process.env?.PGBOX_API_KEY : undefined);
    this.dbUrl = config.dbUrl || (typeof process !== "undefined" ? process.env?.DATABASE_URL : undefined);
    this.database = config.database || "postgres";

    // Dynamic JavaScript Proxy handler for actions
    this.actions = new Proxy({} as Record<string, any>, {
      get: (_target, prop: string) => {
        return (params: Record<string, unknown> = {}, opts: ActionInvokeOptions = {}) => {
          return this.invokeAction(prop, params, opts);
        };
      },
    });
  }

  /** Fetch the structured machine-readable /schema.json metadata */
  async getSchema(): Promise<SchemaJson> {
    const url = `${this.endpoint}/api/v1/databases/${encodeURIComponent(this.database)}/schema.json`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch schema: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<SchemaJson>;
  }

  /** Invoke an action by name with input parameters */
  async invokeAction<T = unknown>(
    actionName: string,
    params: Record<string, unknown> = {},
    options: ActionInvokeOptions = {}
  ): Promise<ActionResponse<T>> {
    const url = `${this.endpoint}/v1/actions/invoke`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        action: actionName,
        params,
        dry_run: options.dryRun || false,
        dbname: this.database,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Action '${actionName}' failed [${res.status}]: ${errorText}`);
    }

    return res.json() as Promise<ActionResponse<T>>;
  }
}

/** Create and initialize a new PGBox client instance */
export function createClient(config?: PGBoxClientConfig): PGBoxClient {
  return new PGBoxClient(config);
}
