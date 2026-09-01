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

export interface QueryOptions<T = any> {
  limit?: number;
  offset?: number;
  orderBy?: keyof T | string;
  order?: "ASC" | "DESC" | "asc" | "desc";
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

/**
 * High-productivity typed table accessor supporting find, findOne, create, update, delete, and count
 */
export class TableClient<T = Record<string, any>> {
  constructor(
    private readonly client: PGBoxClientCore,
    public readonly tableName: string
  ) {}

  /** Find all records matching filter with optional limit, offset, and ordering */
  async find(filter: Partial<T> = {}, options: QueryOptions<T> = {}): Promise<T[]> {
    const res = await this.client.request<{ rows: T[]; count: number }>("/v1/data/find", {
      table: this.tableName,
      filter,
      limit: options.limit ?? 100,
      offset: options.offset ?? 0,
      orderBy: options.orderBy,
      order: options.order ?? "ASC",
    });
    return res.rows || [];
  }

  /** Find first record matching filter */
  async findFirst(filter: Partial<T> = {}, options: QueryOptions<T> = {}): Promise<T | null> {
    const rows = await this.find(filter, { ...options, limit: 1 });
    return rows.length > 0 ? rows[0] : null;
  }

  /** Find single unique record matching filter */
  async findOne(filter: Partial<T>): Promise<T | null> {
    return this.findFirst(filter);
  }

  /** Find unique record matching filter */
  async findUnique(filter: Partial<T>): Promise<T | null> {
    return this.findFirst(filter);
  }

  /** Insert a single record and return the inserted row */
  async create(data: Partial<T>): Promise<T> {
    const res = await this.client.request<{ row: T }>("/v1/data/insert", {
      table: this.tableName,
      data,
    });
    return res.row;
  }

  /** Alias for create */
  async insertOne(data: Partial<T>): Promise<T> {
    return this.create(data);
  }

  /** Update records matching filter */
  async update(filter: Partial<T>, data: Partial<T>): Promise<T[]> {
    const res = await this.client.request<{ rows: T[]; affected_rows: number }>("/v1/data/update", {
      table: this.tableName,
      filter,
      data,
    });
    return res.rows || [];
  }

  /** Update first record matching filter */
  async updateOne(filter: Partial<T>, data: Partial<T>): Promise<T | null> {
    const rows = await this.update(filter, data);
    return rows.length > 0 ? rows[0] : null;
  }

  /** Delete records matching filter */
  async delete(filter: Partial<T>): Promise<{ affected_rows: number }> {
    return this.client.request<{ affected_rows: number }>("/v1/data/delete", {
      table: this.tableName,
      filter,
    });
  }

  /** Delete single record matching filter */
  async deleteOne(filter: Partial<T>): Promise<{ affected_rows: number }> {
    return this.delete(filter);
  }

  /** Count records matching filter */
  async count(filter: Partial<T> = {}): Promise<number> {
    const res = await this.client.request<{ count: number }>("/v1/data/count", {
      table: this.tableName,
      filter,
    });
    return res.count ?? 0;
  }
}

export class PGBoxClientCore {
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly dbUrl?: string;
  readonly database: string;

  /** Actions proxy map (e.g. pgb.actions.saveUser({ ... })) */
  readonly actions: Record<string, (params?: Record<string, unknown>, opts?: ActionInvokeOptions) => Promise<ActionResponse>>;

  constructor(config: PGBoxClientConfig = {}) {
    this.endpoint = (config.endpoint || (typeof process !== "undefined" ? process.env?.PGBOX_ENDPOINT : undefined) || "https://cloud.pgboxhub.com").replace(/\/$/, "");
    this.apiKey = config.apiKey || (typeof process !== "undefined" ? process.env?.PGBOX_API_KEY : undefined);
    this.dbUrl = config.dbUrl || (typeof process !== "undefined" ? process.env?.DATABASE_URL : undefined);
    this.database = config.database || (typeof process !== "undefined" ? process.env?.PGBOX_DATABASE : undefined) || "postgres";

    // Dynamic JavaScript Proxy handler for actions sub-property
    this.actions = new Proxy({} as Record<string, any>, {
      get: (_target, prop: string) => {
        return (params: Record<string, unknown> = {}, opts: ActionInvokeOptions = {}) => {
          return this.invokeAction(prop, params, opts);
        };
      },
    });
  }

  /** Access a table model for typed CRUD operations */
  table<T = Record<string, any>>(name: string): TableClient<T> {
    return new TableClient<T>(this, name);
  }

  /** Collection helper for document store CRUD operations */
  collection(name: string) {
    return {
      insertOne: (doc: Record<string, unknown>) => this.invokeAction(`insert_${name}`, doc),
      find: (filter: Record<string, unknown> = {}) => this.invokeAction(`find_${name}`, filter),
      updateOne: (filter: Record<string, unknown>, update: Record<string, unknown>) => this.invokeAction(`update_${name}`, { filter, update }),
      deleteOne: (filter: Record<string, unknown>) => this.invokeAction(`delete_${name}`, filter),
    };
  }

  /** Generic authenticated API request helper */
  async request<R = unknown>(path: string, body: Record<string, unknown>): Promise<R> {
    const url = `${this.endpoint}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ ...body, dbname: this.database }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`PGBox request to ${path} failed [${res.status}]: ${errorText}`);
    }
    return res.json() as Promise<R>;
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
    return this.request<ActionResponse<T>>("/v1/actions/invoke", {
      action: actionName,
      params,
      dry_run: options.dryRun || false,
    });
  }
}

/** Dynamic PGBox client instance allowing direct table models (e.g. pgbox.user.find(...)) and action calls (e.g. pgb.saveUser({...})) */
export type PGBoxClient = PGBoxClientCore & {
  [key: string]: TableClient<any> & (<T = unknown>(params?: Record<string, unknown>, opts?: ActionInvokeOptions) => Promise<ActionResponse<T>>);
};

/** Create and initialize a new PGBox client instance */
export function createClient(config?: PGBoxClientConfig): PGBoxClient {
  const core = new PGBoxClientCore(config);
  return new Proxy(core, {
    get: (target: any, prop: string | symbol) => {
      if (typeof prop === "string" && !(prop in target)) {
        const tableClient = target.table(prop);
        const actionCallable = (params: Record<string, unknown> = {}, opts: ActionInvokeOptions = {}) => {
          return target.invokeAction(prop, params, opts);
        };
        return new Proxy(actionCallable, {
          get: (_fn, tableProp: string | symbol) => {
            if (tableProp in tableClient) {
              return (tableClient as any)[tableProp].bind(tableClient);
            }
            return undefined;
          },
          apply: (_fn, _thisArg, argArray) => {
            return target.invokeAction(prop, argArray[0] || {}, argArray[1] || {});
          },
        });
      }
      return target[prop];
    },
  }) as PGBoxClient;
}

/** Default singleton instance with shorthand invocation support (e.g. `pgb.user.find({...})` or `pgb.saveUser({...})`) */
export const pgb: PGBoxClient = createClient();
export const PGBox = createClient;
export default pgb;

