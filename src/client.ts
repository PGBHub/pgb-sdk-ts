export interface PGBHubClientConfig {
  /** PGBHub Cloud Endpoint URL (default: https://cloud.pgbhub.com or project URL) */
  endpoint?: string;
  /** PGBHub API Key or Access Token */
  apiKey?: string;
  /** Direct PostgreSQL Connection URL (optional for direct pooler connections) */
  dbUrl?: string;
  /** Database name target (default: postgres) */
  database?: string;
}

export interface PGBHubClientOptions {
  key?: string;
  database?: string;
  dbUrl?: string;
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

export interface SqlQueryResult<T = any> {
  rows: T[];
  row_count: number;
  columns: string[];
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
    private readonly client: PGBHubClientCore,
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

/**
 * Database module for executing SQL queries via HTTP SQL Gateway
 */
export class DbClient {
  constructor(private readonly client: PGBHubClientCore) {}

  /** Execute a parameterised SQL statement via HTTP Database Gateway */
  async query<T = any>(sql: string, params: any[] = []): Promise<SqlQueryResult<T>> {
    const url = `${this.client.endpoint}/sql`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
      },
      body: JSON.stringify({ sql, params }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`PGB SQL query error [${res.status}]: ${errText}`);
    }
    const data = (await res.json()) as any;
    return {
      rows: data.rows || [],
      row_count: data.row_count ?? data.rows?.length ?? 0,
      columns: data.columns || [],
    };
  }
}

export interface AuthUser {
  id: string;
  email: string;
  is_verified?: boolean;
  raw_user_meta?: Record<string, any>;
  created_at?: string;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  user?: AuthUser;
}

/**
 * Built-In PGB Auth-as-a-Service Client.
 *
 * NOT YET IMPLEMENTED on the server: PGBHub has no public `/auth/*` HTTP
 * API today, only internal engine functions and dashboard-session-only
 * routes. Every network method below used to call nonexistent endpoints
 * and fail with a bare 404 that looked like a transient network error.
 * They now throw a clear "not implemented" error instead, until the real
 * backend routes exist (tracked in PGBHub/pgb-cloud's SDK parity plan).
 * `getSession`/`setSession` are pure local state and remain functional.
 */
export class AuthClient {
  private currentSession: AuthSession | null = null;

  constructor(private readonly client: PGBHubClientCore) {}

  private notImplemented(method: string): never {
    throw new Error(
      `PGBHub Auth.${method}() is not implemented yet: the server has no public Auth-as-a-Service API. ` +
        `Track status at https://github.com/PGBHub/pgb-cloud.`
    );
  }

  /** Sign up a new user with email & password */
  async signUp(_options: { email: string; password?: string; metadata?: Record<string, any> }): Promise<{ user: AuthUser; session?: AuthSession }> {
    return this.notImplemented("signUp");
  }

  /** Sign in with email & password */
  async signIn(_options: { email: string; password?: string }): Promise<{ user: AuthUser; session: AuthSession }> {
    return this.notImplemented("signIn");
  }

  /** Sign out and invalidate session */
  async signOut(): Promise<void> {
    this.currentSession = null;
    return this.notImplemented("signOut");
  }

  /** Get current authenticated user details */
  async getUser(): Promise<AuthUser | null> {
    return this.notImplemented("getUser");
  }

  /** Get current active session */
  getSession(): AuthSession | null {
    return this.currentSession;
  }

  /** Set active session */
  setSession(session: AuthSession | null): void {
    this.currentSession = session;
  }

  /** Verify OTP token */
  async verifyOtp(_options: { email: string; token: string; type?: string }): Promise<{ user: AuthUser; session: AuthSession }> {
    return this.notImplemented("verifyOtp");
  }

  /** Send passwordless magic link */
  async sendMagicLink(_options: { email: string }): Promise<{ success: boolean; message?: string }> {
    return this.notImplemented("sendMagicLink");
  }
}

/**
 * Storage Client for Cloudflare R2 Assets
 */
export class StorageClient {
  constructor(private readonly client: PGBHubClientCore) {}

  /** Upload an asset or file to Cloudflare R2 storage */
  async upload(
    filePath: string,
    data: any,
    options: { contentType?: string } = {}
  ): Promise<{ path: string; url: string; size?: number }> {
    const cleanPath = filePath.replace(/^\/+/, "");
    // First obtain presigned upload URL
    const presignRes = await fetch(`${this.client.endpoint}/storage/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
      },
      body: JSON.stringify({
        file_path: cleanPath,
        content_type: options.contentType || "application/octet-stream",
      }),
    });

    if (presignRes.ok) {
      const presignData = (await presignRes.json()) as any;
      if (presignData.upload_url) {
        // Direct upload to R2
        const putRes = await fetch(presignData.upload_url, {
          method: "PUT",
          headers: {
            "Content-Type": options.contentType || "application/octet-stream",
          },
          body: data,
        });
        if (!putRes.ok) throw new Error(`Failed to upload file to R2 [${putRes.status}]`);
        return {
          path: cleanPath,
          url: presignData.public_url || this.getPublicUrl(cleanPath),
        };
      }
    }

    // Direct upload fallback
    const directRes = await fetch(`${this.client.endpoint}/storage/${cleanPath}`, {
      method: "PUT",
      headers: {
        "Content-Type": options.contentType || "application/octet-stream",
        ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
      },
      body: data,
    });
    if (!directRes.ok) throw new Error(`Storage upload failed [${directRes.status}]: ${await directRes.text()}`);
    return {
      path: cleanPath,
      url: this.getPublicUrl(cleanPath),
    };
  }

  /** Get public CDN URL for an asset */
  getPublicUrl(filePath: string): string {
    const cleanPath = filePath.replace(/^\/+/, "");
    return `${this.client.endpoint}/storage/${cleanPath}`;
  }

  /** Delete a stored asset */
  async delete(filePath: string): Promise<boolean> {
    const cleanPath = filePath.replace(/^\/+/, "");
    // The server only supports deletion via POST /storage/delete with a
    // JSON body — there is no DELETE /storage/{path} route. A path-based
    // DELETE silently falls through to the unrelated raw-file-delivery
    // branch and never deletes anything.
    const res = await fetch(`${this.client.endpoint}/storage/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
      },
      body: JSON.stringify({ path: cleanPath }),
    });
    return res.ok;
  }

  /** List assets under a prefix */
  async list(prefix: string = ""): Promise<Array<{ path: string; size: number; updated_at: string }>> {
    const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
    const res = await fetch(`${this.client.endpoint}/storage/list${query}`, {
      headers: {
        Accept: "application/json",
        ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    // The server returns { objects, count }, not { files }.
    return data.objects || [];
  }
}

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
}

export interface MailSendResult {
  success: boolean;
  message_id?: string;
  /** Present only when `to` had more than one recipient (see note below). */
  results?: Array<{ to: string; success: boolean; message_id?: string; error?: string }>;
}

/**
 * Transactional Mail Client
 */
export class MailClient {
  constructor(private readonly client: PGBHubClientCore) {}

  private async sendOne(options: SendMailOptions, to: string): Promise<{ success: boolean; message_id?: string }> {
    const res = await fetch(`${this.client.endpoint}/mail/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
      },
      body: JSON.stringify({
        to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        from: options.from,
        reply_to: options.replyTo,
      }),
    });
    if (!res.ok) {
      throw new Error(`Mail send to ${to} failed [${res.status}]: ${await res.text()}`);
    }
    return (await res.json()) as any;
  }

  /**
   * Send transactional email.
   *
   * The server's `/mail/send` endpoint accepts exactly one `to` address
   * per request, not an array — sending the array as-is (the old
   * behavior) produced a stringified list like `"['a@x.com']"` that
   * always failed server-side email validation, so every send failed.
   * A single string `to` sends one request as before; an array sends
   * one request per recipient and aggregates the results instead of
   * silently delivering to only one address.
   */
  async send(options: SendMailOptions): Promise<MailSendResult> {
    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    if (recipients.length === 0) {
      throw new Error("Mail send failed: 'to' must include at least one recipient");
    }
    if (recipients.length === 1) {
      return this.sendOne(options, recipients[0]);
    }
    const results = await Promise.all(
      recipients.map(async (to) => {
        try {
          const r = await this.sendOne(options, to);
          return { to, success: r.success !== false, message_id: r.message_id };
        } catch (err) {
          return { to, success: false, error: err instanceof Error ? err.message : String(err) };
        }
      })
    );
    return { success: results.every((r) => r.success), results };
  }
}

export interface FunctionInvokeOptions {
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

/**
 * Serverless Cloud & Edge Functions Client
 */
export class FunctionsClient {
  constructor(private readonly client: PGBHubClientCore) {}

  /** Invoke a serverless cloud function with ambient DB access */
  async invoke<T = any>(
    functionName: string,
    payload: any = {},
    options: FunctionInvokeOptions = {}
  ): Promise<T> {
    const queryStr = options.query ? `?${new URLSearchParams(options.query).toString()}` : "";
    const cleanFn = functionName.replace(/^\/+/, "");
    // Try project-scoped function invocation first (/functions/:name)
    const projectUrl = `${this.client.endpoint}/functions/${encodeURIComponent(cleanFn)}${queryStr}`;
    let res = await fetch(projectUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
        ...(options.headers || {}),
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 404) {
      // Fallback to database-scoped function route
      const fallbackUrl = `${this.client.endpoint}/api/v1/databases/${encodeURIComponent(this.client.database)}/functions/${encodeURIComponent(cleanFn)}/invoke${queryStr}`;
      res = await fetch(fallbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
          ...(options.headers || {}),
        },
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Function '${functionName}' invocation failed [${res.status}]: ${err}`);
    }
    return res.json() as Promise<T>;
  }

  /** List all configured cloud functions */
  async list(): Promise<any[]> {
    const url = `${this.client.endpoint}/api/v1/databases/${encodeURIComponent(this.client.database)}/functions`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`Failed to list functions: ${res.statusText}`);
    const data = await res.json();
    return data.functions || [];
  }
}

export class PGBHubClientCore {
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly dbUrl?: string;
  readonly database: string;

  /** HTTP Database Gateway Query API */
  public readonly db: DbClient = new DbClient(this);

  /** Built-In Auth-as-a-Service API */
  public readonly auth: AuthClient = new AuthClient(this);

  /** Storage R2 Asset API */
  public readonly storage: StorageClient = new StorageClient(this);

  /** Transactional Email Dispatch API */
  public readonly mail: MailClient = new MailClient(this);

  /** Functions API client namespace */
  public readonly functions: FunctionsClient = new FunctionsClient(this);

  /** Actions proxy map (e.g. pgb.actions.saveUser({ ... })) */
  readonly actions: Record<string, (params?: Record<string, unknown>, opts?: ActionInvokeOptions) => Promise<ActionResponse>>;

  constructor(config: PGBHubClientConfig = {}) {
    this.endpoint = (config.endpoint || (typeof process !== "undefined" ? process.env?.PGBHUB_ENDPOINT || process.env?.PGBHUB_PROJECT_URL : undefined) || "https://cloud.pgbhub.com").replace(/\/$/, "");
    this.apiKey = config.apiKey || (typeof process !== "undefined" ? process.env?.PGBHUB_API_KEY || process.env?.PGBHUB_PUBLISHABLE_KEY : undefined);
    this.dbUrl = config.dbUrl || (typeof process !== "undefined" ? process.env?.DATABASE_URL : undefined);
    this.database = config.database || (typeof process !== "undefined" ? process.env?.PGBHUB_DATABASE : undefined) || "postgres";

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
      throw new Error(`PGBHub request to ${path} failed [${res.status}]: ${errorText}`);
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

/** Dynamic PGBHub client instance allowing direct table models (e.g. pgbhub.user.find(...)) and action calls (e.g. pgb.saveUser({...})) */
export type PGBHubClient = PGBHubClientCore & {
  [key: string]: TableClient<any> & (<T = unknown>(params?: Record<string, unknown>, opts?: ActionInvokeOptions) => Promise<ActionResponse<T>>);
};

/** Create and initialize a new PGBHub client instance */
export function createClient(
  projectUrlOrConfig?: string | PGBHubClientConfig,
  options?: PGBHubClientOptions
): PGBHubClient {
  let config: PGBHubClientConfig = {};
  if (typeof projectUrlOrConfig === "string") {
    let endpoint = projectUrlOrConfig.trim();
    if (!endpoint.startsWith("http://") && !endpoint.startsWith("https://")) {
      endpoint = `https://${endpoint}.pgbhub.dev`;
    }
    config = {
      endpoint,
      apiKey: options?.key,
      database: options?.database,
      dbUrl: options?.dbUrl,
    };
  } else if (projectUrlOrConfig) {
    config = projectUrlOrConfig;
  }

  const core = new PGBHubClientCore(config);
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
  }) as PGBHubClient;
}

/** Default singleton instance with shorthand invocation support (e.g. `pgb.user.find({...})` or `pgb.db.query(...)`) */
export const pgb: PGBHubClient = createClient();
export const PGBHub = createClient;
export default pgb;
