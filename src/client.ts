export interface PGBHubClientConfig {
  /** PGBHub Cloud Endpoint URL (default: https://cloud.pgbhub.com or project URL) */
  endpoint?: string;
  /** PGBHub API Key or Access Token */
  apiKey?: string;
  /** Direct PostgreSQL Connection URL (optional for direct pooler connections) */
  dbUrl?: string;
  /** Database name target (default: postgres) */
  database?: string;
  /** Project ID — required by QueuesClient, whose routes are addressed by project rather than database. */
  projectId?: string;
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
  token_type?: string;
  expires_in?: number;
  expires_at?: string;
  user?: AuthUser;
}

export interface AuthResult {
  user: AuthUser;
  session: AuthSession;
}

export interface LoginResult {
  user?: AuthUser;
  session?: AuthSession;
  /** Present instead of user/session when the account has MFA enabled — redeem via a future completeMfaLogin() call. */
  mfa_required?: boolean;
  challenge_token?: string;
  expires_in?: number;
}

/**
 * Built-In PGB Auth-as-a-Service Client.
 *
 * Backed by PGBHub's project-ingress `/auth/*` HTTP API
 * (pgb-cloud/app/routers/auth_ingress.py). Two different bearer tokens
 * are in play: the client's own `apiKey` (a project Secret/Publishable
 * key) identifies the *project*, sent as `Authorization: Bearer <key>`
 * on every call; the *end user's* own access token (held in
 * `currentSession`, settable via `setSession`) is sent separately as
 * `X-PGB-User-Token` on the handful of routes that need to know who's
 * calling (getUser, signOut).
 */
export class AuthClient {
  private currentSession: AuthSession | null = null;

  /** Admin user management — requires a Secret key, not Publishable. */
  readonly admin: AuthAdminClient;

  constructor(private readonly client: PGBHubClientCore) {
    this.admin = new AuthAdminClient(client);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
      ...extra,
    };
  }

  private async post<T = any>(path: string, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${this.client.endpoint}${path}`, {
      method: "POST",
      headers: this.headers(extraHeaders),
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      throw new Error(`PGBHub Auth ${path} failed [${res.status}]: ${data.error || JSON.stringify(data)}`);
    }
    return data as T;
  }

  /** Sign up a new user with email & password */
  async signUp(options: { email: string; password?: string; metadata?: Record<string, any> }): Promise<AuthResult> {
    const result = await this.post<AuthResult>("/auth/signup", {
      email: options.email,
      password: options.password,
      metadata: options.metadata || {},
    });
    this.currentSession = result.session;
    return result;
  }

  /** Sign in with email & password */
  async signIn(options: { email: string; password?: string }): Promise<LoginResult> {
    const result = await this.post<LoginResult>("/auth/login", {
      email: options.email,
      password: options.password,
    });
    if (result.session) {
      this.currentSession = result.session;
    }
    return result;
  }

  /** Sign out and invalidate the current session */
  async signOut(): Promise<void> {
    const token = this.currentSession?.access_token;
    if (token) {
      try {
        await this.post("/auth/logout", {}, { "X-PGB-User-Token": token });
      } catch {
        // Best effort — a failed server-side revoke must not block clearing local state.
      }
    }
    this.currentSession = null;
  }

  /** Get current authenticated user details */
  async getUser(): Promise<AuthUser | null> {
    const token = this.currentSession?.access_token;
    if (!token) return null;
    const res = await fetch(`${this.client.endpoint}/auth/user`, {
      headers: this.headers({ "X-PGB-User-Token": token }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    return data.user || null;
  }

  /** Get current active session */
  getSession(): AuthSession | null {
    return this.currentSession;
  }

  /** Set active session */
  setSession(session: AuthSession | null): void {
    this.currentSession = session;
  }

  /** Exchange a refresh token for a new session, rotating the refresh token */
  async refreshSession(refreshToken?: string): Promise<AuthResult> {
    const token = refreshToken || this.currentSession?.refresh_token;
    if (!token) throw new Error("PGBHub Auth refreshSession() requires a refresh token (none provided and no active session).");
    const result = await this.post<AuthResult>("/auth/refresh", { refresh_token: token });
    this.currentSession = result.session;
    return result;
  }

  /** Request a one-time passcode be issued for passwordless sign-in */
  async requestOtp(options: { email: string }): Promise<{ message: string; expires_in: number }> {
    return this.post("/auth/otp", { email: options.email });
  }

  /** Verify a one-time passcode and establish a session */
  async verifyOtp(options: { email: string; token: string }): Promise<AuthResult> {
    const result = await this.post<AuthResult>("/auth/otp/verify", { email: options.email, token: options.token });
    this.currentSession = result.session;
    return result;
  }

  /** Send a passwordless magic link */
  async sendMagicLink(options: { email: string }): Promise<{ message: string; token: string; expires_in: number }> {
    return this.post("/auth/magic", { email: options.email });
  }

  /** Verify a magic link token and establish a session */
  async verifyMagicLink(options: { token: string }): Promise<AuthResult> {
    const result = await this.post<AuthResult>("/auth/magic/verify", { token: options.token });
    this.currentSession = result.session;
    return result;
  }
}

/**
 * Admin user management (`pgb.auth.admin.*`) — Secret-key-only, mirrors
 * routers/auth_ingress.py's /auth/admin/users CRUD exactly.
 */
export class AuthAdminClient {
  constructor(private readonly client: PGBHubClientCore) {}

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
    };
  }

  private async request<T = any>(path: string, method: string, body?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.client.endpoint}${path}`, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      throw new Error(`PGBHub Auth Admin ${method} ${path} failed [${res.status}]: ${data.error || JSON.stringify(data)}`);
    }
    return data as T;
  }

  /** List users registered in this project */
  async listUsers(): Promise<AuthUser[]> {
    const data = await this.request<{ users: AuthUser[] }>("/auth/admin/users", "GET");
    return data.users || [];
  }

  /** Create a user directly (bypasses signup email verification) */
  async createUser(options: { email: string; password?: string; metadata?: Record<string, any>; isVerified?: boolean }): Promise<AuthUser> {
    const data = await this.request<{ user: AuthUser }>("/auth/admin/users", "POST", {
      email: options.email,
      password: options.password,
      metadata: options.metadata || {},
      is_verified: options.isVerified ?? true,
    });
    return data.user;
  }

  /** Fetch a single user by ID */
  async getUser(userId: string): Promise<AuthUser | null> {
    try {
      const data = await this.request<{ user: AuthUser }>(`/auth/admin/users/${encodeURIComponent(userId)}`, "GET");
      return data.user;
    } catch {
      return null;
    }
  }

  /** Update a user's password, metadata, or verification status */
  async updateUser(userId: string, updates: { password?: string; metadata?: Record<string, any>; isVerified?: boolean }): Promise<AuthUser> {
    const body: Record<string, unknown> = {};
    if (updates.password !== undefined) body.password = updates.password;
    if (updates.metadata !== undefined) body.metadata = updates.metadata;
    if (updates.isVerified !== undefined) body.is_verified = updates.isVerified;
    const data = await this.request<{ user: AuthUser }>(`/auth/admin/users/${encodeURIComponent(userId)}`, "PATCH", body);
    return data.user;
  }

  /** Delete a user and invalidate their sessions */
  async deleteUser(userId: string): Promise<boolean> {
    const data = await this.request<{ success: boolean }>(`/auth/admin/users/${encodeURIComponent(userId)}`, "DELETE");
    return !!data.success;
  }
}

export interface StorageFile {
  data: ArrayBuffer;
  contentType: string;
  path: string;
  etag?: string;
}

export interface MediaTransformOptions {
  width?: number;
  height?: number;
  format?: "webp" | "jpeg" | "png" | "avif";
  fit?: "cover" | "contain" | "fill";
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

  /** Download a stored file's raw bytes */
  async getFile(filePath: string): Promise<StorageFile> {
    const cleanPath = filePath.replace(/^\/+/, "");
    const res = await fetch(`${this.client.endpoint}/storage/${cleanPath}`, {
      headers: {
        Accept: "*/*",
        ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Storage getFile('${filePath}') failed [${res.status}]: ${await res.text()}`);
    }
    const data = await res.arrayBuffer();
    return {
      data,
      contentType: res.headers.get("content-type") || "application/octet-stream",
      path: cleanPath,
      etag: res.headers.get("etag") || undefined,
    };
  }

  /**
   * Download a stored image, optionally requesting a transform.
   *
   * The server does not implement on-the-fly image transforms yet (no
   * width/height/format handling exists in its storage delivery route) —
   * `options` is accepted here for forward compatibility only and
   * currently has no effect. This returns the original file unmodified,
   * identically to getFile(). Do not rely on resizing/format conversion
   * actually happening until PGBHub ships real transform support.
   */
  async getMedia(filePath: string, _options: MediaTransformOptions = {}): Promise<StorageFile> {
    return this.getFile(filePath);
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

export interface FunctionDeployOptions {
  title?: string;
  description?: string;
  runtime?: string;
  entrypoint?: string;
  triggerType?: string;
  triggerConfig?: Record<string, unknown>;
  envVars?: Record<string, string>;
  isEnabled?: boolean;
  timeoutMs?: number;
  memoryMb?: number;
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

  /**
   * Create or update a serverless cloud function's code and configuration.
   *
   * The server's save-function logic is an upsert regardless of which
   * route calls it, so this always POSTs to the functions collection
   * endpoint (name goes in the body, not the URL) rather than needing to
   * check existence first and switch between POST/PUT.
   */
  async deploy(name: string, code: string, options: FunctionDeployOptions = {}): Promise<any> {
    const url = `${this.client.endpoint}/api/v1/databases/${encodeURIComponent(this.client.database)}/functions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
      },
      body: JSON.stringify({
        name,
        code,
        title: options.title,
        description: options.description,
        runtime: options.runtime,
        entrypoint: options.entrypoint,
        trigger_type: options.triggerType,
        trigger_config: options.triggerConfig,
        env_vars: options.envVars,
        is_enabled: options.isEnabled,
        timeout_ms: options.timeoutMs,
        memory_mb: options.memoryMb,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Function deploy '${name}' failed [${res.status}]: ${data.error || JSON.stringify(data)}`);
    }
    return data.function ?? data;
  }

  /** Delete a cloud function */
  async delete(name: string): Promise<boolean> {
    const url = `${this.client.endpoint}/api/v1/databases/${encodeURIComponent(this.client.database)}/functions/${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Function delete '${name}' failed [${res.status}]: ${data.error || JSON.stringify(data)}`);
    }
    return !!data.success;
  }
}

// ─── Cron ──────────────────────────────────────────────────────────────

export interface CronJob {
  id: string;
  name: string;
  description?: string;
  expression: string;
  timezone: string;
  target_type: string;
  target_config: Record<string, unknown>;
  is_enabled: boolean;
  concurrency_policy: string;
  timeout_seconds: number;
  max_retries: number;
  retry_delay_seconds: number;
  last_run_at?: string | null;
  last_status?: string | null;
  last_duration_ms?: number | null;
  next_run_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CronRun {
  id: string;
  cron_id: string;
  status: string;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  error?: string | null;
}

export interface CreateCronJobOptions {
  description?: string;
  timezone?: string;
  isEnabled?: boolean;
  concurrencyPolicy?: string;
  timeoutSeconds?: number;
  maxRetries?: number;
  retryDelaySeconds?: number;
}

export interface UpdateCronJobFields {
  name?: string;
  description?: string;
  expression?: string;
  timezone?: string;
  concurrencyPolicy?: string;
  timeoutSeconds?: number;
  maxRetries?: number;
  targetType?: string;
  targetConfig?: Record<string, unknown>;
}

/**
 * Scheduled (cron) job management.
 *
 * `cron-job` routes are addressed by database name
 * (`/api/v1/databases/{db}/crons/...`) — target_config's shape depends
 * on target_type: function -> {function_name, payload}, sql -> {sql},
 * action -> {action_name, params}, http -> {url, method, body?},
 * mail -> {to, subject, body}.
 */
export class CronClient {
  constructor(private readonly client: PGBHubClientCore) {}

  private get base(): string {
    return `${this.client.endpoint}/api/v1/databases/${encodeURIComponent(this.client.database)}/crons`;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
    };
  }

  private async handle<T>(res: Response, label: string): Promise<T> {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Cron ${label} failed [${res.status}]: ${data.error || JSON.stringify(data)}`);
    }
    return data as T;
  }

  /** List scheduled cron jobs */
  async list(): Promise<CronJob[]> {
    const res = await fetch(this.base, { headers: this.headers() });
    const data = await this.handle<{ crons: CronJob[] }>(res, "list");
    return data.crons || [];
  }

  /** Create a scheduled cron job */
  async create(
    name: string,
    expression: string,
    targetType: string,
    targetConfig: Record<string, unknown>,
    options: CreateCronJobOptions = {}
  ): Promise<CronJob> {
    const res = await fetch(this.base, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        name,
        expression,
        target_type: targetType,
        target_config: targetConfig,
        description: options.description,
        timezone: options.timezone,
        is_enabled: options.isEnabled,
        concurrency_policy: options.concurrencyPolicy,
        timeout_seconds: options.timeoutSeconds,
        max_retries: options.maxRetries,
        retry_delay_seconds: options.retryDelaySeconds,
      }),
    });
    return this.handle<CronJob>(res, "create");
  }

  /** Enable or disable a cron job */
  async toggle(cronId: string, enabled: boolean): Promise<CronJob> {
    const res = await fetch(`${this.base}/${encodeURIComponent(cronId)}/toggle`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ enabled }),
    });
    return this.handle<CronJob>(res, "toggle");
  }

  /** Manually trigger a cron job to run immediately */
  async run(cronId: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.base}/${encodeURIComponent(cronId)}/run`, {
      method: "POST",
      headers: this.headers(),
    });
    return this.handle(res, "run");
  }

  /** Delete a cron job */
  async delete(cronId: string): Promise<{ deleted: boolean; id: string }> {
    const res = await fetch(`${this.base}/${encodeURIComponent(cronId)}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    return this.handle(res, "delete");
  }

  /** List recent run history for a cron job */
  async listRuns(cronId: string, limit: number = 50): Promise<CronRun[]> {
    const res = await fetch(`${this.base}/${encodeURIComponent(cronId)}/runs?limit=${limit}`, {
      headers: this.headers(),
    });
    const data = await this.handle<{ runs: CronRun[] }>(res, "listRuns");
    return data.runs || [];
  }

  /** Update a cron job's configuration */
  async update(cronId: string, updates: UpdateCronJobFields): Promise<CronJob> {
    const body: Record<string, unknown> = {};
    if (updates.name !== undefined) body.name = updates.name;
    if (updates.description !== undefined) body.description = updates.description;
    if (updates.expression !== undefined) body.expression = updates.expression;
    if (updates.timezone !== undefined) body.timezone = updates.timezone;
    if (updates.concurrencyPolicy !== undefined) body.concurrency_policy = updates.concurrencyPolicy;
    if (updates.timeoutSeconds !== undefined) body.timeout_seconds = updates.timeoutSeconds;
    if (updates.maxRetries !== undefined) body.max_retries = updates.maxRetries;
    if (updates.targetType !== undefined) body.target_type = updates.targetType;
    if (updates.targetConfig !== undefined) body.target_config = updates.targetConfig;

    const res = await fetch(`${this.base}/${encodeURIComponent(cronId)}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    return this.handle<CronJob>(res, "update");
  }
}

// ─── Jobs ──────────────────────────────────────────────────────────────

export type JobTargetType = "function" | "webhook" | "sql";
export type JobStatus = "pending" | "running" | "done" | "failed" | "dead" | "cancelled";

export interface BackgroundJob {
  id: number;
  job_type: string;
  target_type: JobTargetType;
  target_config: Record<string, unknown>;
  payload?: unknown;
  status: JobStatus;
  idempotency_key?: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at?: string | null;
  locked_by?: string | null;
  locked_until?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnqueueJobOptions {
  payload?: unknown;
  idempotencyKey?: string;
  maxAttempts?: number;
}

export interface ListJobsOptions {
  status?: JobStatus;
  limit?: number;
}

/**
 * On-demand asynchronous background job queue (`client.jobs`). Execution
 * happens out-of-band in the server's own jobs scheduler — these methods
 * only enqueue/inspect/cancel.
 */
export class JobsClient {
  constructor(private readonly client: PGBHubClientCore) {}

  private get base(): string {
    return `${this.client.endpoint}/api/v1/databases/${encodeURIComponent(this.client.database)}/jobs`;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
    };
  }

  private async handle<T>(res: Response, label: string): Promise<T> {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Jobs ${label} failed [${res.status}]: ${data.error || JSON.stringify(data)}`);
    }
    return data as T;
  }

  /** Enqueue a new background job */
  async enqueue(
    jobType: string,
    targetType: JobTargetType,
    targetConfig: Record<string, unknown>,
    options: EnqueueJobOptions = {}
  ): Promise<BackgroundJob> {
    const res = await fetch(this.base, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        job_type: jobType,
        target_type: targetType,
        target_config: targetConfig,
        payload: options.payload,
        idempotency_key: options.idempotencyKey,
        max_attempts: options.maxAttempts,
      }),
    });
    const data = await this.handle<{ success: boolean; job: BackgroundJob }>(res, "enqueue");
    return data.job;
  }

  /** Fetch a single job by ID, or null if not found */
  async get(jobId: number): Promise<BackgroundJob | null> {
    const res = await fetch(`${this.base}/${jobId}`, { headers: this.headers() });
    if (res.status === 404) return null;
    const data = await this.handle<{ success: boolean; job: BackgroundJob }>(res, "get");
    return data.job;
  }

  /** List jobs, optionally filtered by status */
  async list(options: ListJobsOptions = {}): Promise<BackgroundJob[]> {
    const params = new URLSearchParams();
    if (options.status) params.set("status", options.status);
    if (options.limit) params.set("limit", String(options.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(`${this.base}${qs}`, { headers: this.headers() });
    const data = await this.handle<{ success: boolean; jobs: BackgroundJob[]; total: number }>(res, "list");
    return data.jobs || [];
  }

  /** Cancel a pending/running job. Returns false if it could not be cancelled (already running or finished). */
  async cancel(jobId: number): Promise<boolean> {
    const res = await fetch(`${this.base}/${jobId}/cancel`, { method: "POST", headers: this.headers() });
    if (res.status === 409) return false;
    const data = await this.handle<{ success: boolean; cancelled: boolean }>(res, "cancel");
    return !!data.cancelled;
  }
}

// ─── Queues ──────────────────────────────────────────────────────────────

export interface SendMessageOptions {
  delaySeconds?: number;
  deduplicationId?: string;
}

export interface SentMessage {
  message_id: string;
  queue_name: string;
  status: string;
  scheduled_at?: string;
  created_at?: string;
  deduplicated: boolean;
}

export interface ReceivedMessage {
  message_id: string;
  payload: unknown;
  [key: string]: unknown;
}

export interface ReceiveMessagesOptions {
  maxMessages?: number;
  visibilityTimeout?: number;
  consumerId?: string;
}

/**
 * Durable message queues (`client.queues`). Unlike Cron/Jobs/Functions,
 * these routes are addressed by project ID, not database name
 * (`/api/v1/projects/{projectId}/queues/{queueName}/...`) — pass
 * `projectId` to createClient()/PGBHubClientCore or set
 * PGBHUB_PROJECT_ID. Queue creation/deletion is dashboard-only today
 * (no API route exists); this client covers send/receive/ack/nack
 * against an already-created queue.
 */
export class QueuesClient {
  constructor(private readonly client: PGBHubClientCore) {}

  private requireProjectId(): string {
    if (!this.client.projectId) {
      throw new Error(
        "QueuesClient requires a projectId — pass { projectId } to createClient()/PGBHubClientCore, or set PGBHUB_PROJECT_ID."
      );
    }
    return this.client.projectId;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
    };
  }

  private async handle<T>(res: Response, label: string): Promise<T> {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Queues ${label} failed [${res.status}]: ${data.error || JSON.stringify(data)}`);
    }
    return data as T;
  }

  private url(queueName: string, action: string): string {
    return `${this.client.endpoint}/api/v1/projects/${encodeURIComponent(this.requireProjectId())}/queues/${encodeURIComponent(queueName)}/${action}`;
  }

  /** Send a message to a queue */
  async send(queueName: string, payload: unknown, options: SendMessageOptions = {}): Promise<SentMessage> {
    const res = await fetch(this.url(queueName, "send"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ payload, delay_seconds: options.delaySeconds, deduplication_id: options.deduplicationId }),
    });
    const data = await this.handle<{ ok: boolean; message: SentMessage }>(res, "send");
    return data.message;
  }

  /** Receive (and lease) messages from a queue */
  async receive(queueName: string, options: ReceiveMessagesOptions = {}): Promise<ReceivedMessage[]> {
    const res = await fetch(this.url(queueName, "receive"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        max_messages: options.maxMessages,
        visibility_timeout: options.visibilityTimeout,
        consumer_id: options.consumerId,
      }),
    });
    const data = await this.handle<{ ok: boolean; count: number; messages: ReceivedMessage[] }>(res, "receive");
    return data.messages || [];
  }

  /** Acknowledge (delete) a successfully processed message */
  async ack(queueName: string, messageId: string): Promise<boolean> {
    const res = await fetch(this.url(queueName, "ack"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ message_id: messageId }),
    });
    const data = await this.handle<{ ok: boolean }>(res, "ack");
    return !!data.ok;
  }

  /** Negatively acknowledge a message — returns it to the queue (or to the DLQ past max retries) */
  async nack(queueName: string, messageId: string, error?: string): Promise<boolean> {
    const res = await fetch(this.url(queueName, "nack"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ message_id: messageId, error }),
    });
    const data = await this.handle<{ ok: boolean }>(res, "nack");
    return !!data.ok;
  }
}

// ─── Realtime ────────────────────────────────────────────────────────────

export interface BroadcastOptions {
  event?: string;
  senderId?: string;
}

export interface BroadcastResult {
  ok: boolean;
  broadcast: Record<string, unknown>;
}

export interface RealtimeEvent {
  event: string;
  data: unknown;
}

/**
 * Realtime broadcast/subscribe channels (`client.realtime`). Channel
 * names are namespaced server-side by project, so two different
 * projects' channels of the same name never collide; pass `projectId`
 * for callers reaching the bare (non-project-path) routes without a
 * project-scoped key, the same way QueuesClient needs it.
 */
export class RealtimeClient {
  constructor(private readonly client: PGBHubClientCore) {}

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
      ...(this.client.projectId ? { "X-PGB-Project-ID": this.client.projectId } : {}),
    };
  }

  /** Broadcast a message to a realtime channel */
  async broadcast(channel: string, payload: unknown, options: BroadcastOptions = {}): Promise<BroadcastResult> {
    const url = `${this.client.endpoint}/api/v1/realtime/channels/${encodeURIComponent(channel)}/broadcast`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ channel, event: options.event || "message", payload, sender_id: options.senderId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Realtime broadcast failed [${res.status}]: ${data.error || JSON.stringify(data)}`);
    }
    return data as BroadcastResult;
  }

  /**
   * Subscribe to a realtime channel via Server-Sent Events. Returns an
   * unsubscribe function. Requires a fetch implementation whose Response
   * exposes a readable stream body (Node 18+, browsers, Deno, Bun).
   */
  subscribe(channel: string, onEvent: (evt: RealtimeEvent) => void, onError?: (err: unknown) => void): () => void {
    const controller = new AbortController();
    const url = `${this.client.endpoint}/api/v1/realtime/stream?channel=${encodeURIComponent(channel)}`;

    (async () => {
      try {
        const res = await fetch(url, {
          headers: { Accept: "text/event-stream", ...this.headers() },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`Realtime subscribe failed [${res.status}]`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "message";
        let currentData: string[] = [];

        const flush = () => {
          if (currentData.length === 0) return;
          const raw = currentData.join("\n");
          let parsed: unknown = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // leave as the raw string
          }
          onEvent({ event: currentEvent, data: parsed });
          currentEvent = "message";
          currentData = [];
        };

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line === "") {
              flush();
            } else if (line.startsWith("event:")) {
              currentEvent = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              currentData.push(line.slice(5).trim());
            }
          }
        }
      } catch (err) {
        if ((err as { name?: string } | null)?.name !== "AbortError" && onError) {
          onError(err);
        }
      }
    })();

    return () => controller.abort();
  }
}

export class PGBHubClientCore {
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly dbUrl?: string;
  readonly database: string;
  readonly projectId?: string;

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

  /** Scheduled (cron) job management */
  public readonly cron: CronClient = new CronClient(this);

  /** On-demand asynchronous background job queue */
  public readonly jobs: JobsClient = new JobsClient(this);

  /** Durable message queues (send/receive/ack/nack) */
  public readonly queues: QueuesClient = new QueuesClient(this);

  /** Realtime broadcast/subscribe channels */
  public readonly realtime: RealtimeClient = new RealtimeClient(this);

  /** Actions proxy map (e.g. pgb.actions.saveUser({ ... })) */
  readonly actions: Record<string, (params?: Record<string, unknown>, opts?: ActionInvokeOptions) => Promise<ActionResponse>>;

  constructor(config: PGBHubClientConfig = {}) {
    this.endpoint = (config.endpoint || (typeof process !== "undefined" ? process.env?.PGBHUB_ENDPOINT || process.env?.PGBHUB_PROJECT_URL : undefined) || "https://cloud.pgbhub.com").replace(/\/$/, "");
    this.apiKey = config.apiKey || (typeof process !== "undefined" ? process.env?.PGBHUB_API_KEY || process.env?.PGBHUB_PUBLISHABLE_KEY : undefined);
    this.dbUrl = config.dbUrl || (typeof process !== "undefined" ? process.env?.DATABASE_URL : undefined);
    this.database = config.database || (typeof process !== "undefined" ? process.env?.PGBHUB_DATABASE : undefined) || "postgres";
    this.projectId = config.projectId || (typeof process !== "undefined" ? process.env?.PGBHUB_PROJECT_ID : undefined);

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

  /**
   * Provision a new PGBHub-managed PostgreSQL database.
   *
   * Requires an account-level API key (one created with scope_type
   * "account", not a project-scoped `pgb_sec_`/`pgb_pub_` key) — a
   * project key is permanently bound to the one database it was issued
   * for and the server rejects (403) any attempt to use it to provision
   * an unrelated new one.
   */
  async createDatabase(name: string, options: { pgVersion?: string; extensions?: string[] } = {}): Promise<{
    database: string;
    pg_version: string;
    extensions: string[];
    user: string;
    password: string;
    public_host: string;
    public_port: number;
    url: string;
    message: string;
  }> {
    const url = `${this.endpoint}/api/v1/databases`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        name,
        pg_version: options.pgVersion || "17",
        extensions: options.extensions,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`createDatabase('${name}') failed [${res.status}]: ${data.error || JSON.stringify(data)}`);
    }
    return data;
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
