/**
 * An HTTP or network failure talking to PGBHub. `message` is human-readable and
 * safe to show; the fields let code react without parsing it.
 */
export class PGBError extends Error {
  /** HTTP status, or undefined for a network failure or timeout. */
  readonly status?: number;
  /** "network_error" or "timeout" for transport failures; otherwise the server's own `code` when it sent one. */
  readonly code?: string;
  /** The server's response body, when there was one. */
  readonly body?: unknown;
  /** Seconds to wait before retrying, from a 429's Retry-After header. */
  readonly retryAfter?: number;

  constructor(message: string, details: { status?: number; code?: string; body?: unknown; retryAfter?: number } = {}) {
    super(message);
    this.name = "PGBError";
    this.status = details.status;
    this.code = details.code;
    this.body = details.body;
    this.retryAfter = details.retryAfter;
  }
}

/** Pulls the human message out of a PGBHub error body ({"error": ...} or FastAPI's {"detail": ...}). */
export function errorMessageFrom(body: any, fallback = ""): string {
  if (body && typeof body === "object") {
    if (typeof body.error === "string") return body.error;
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) return body.detail.map((d: any) => d?.msg || JSON.stringify(d)).join("; ");
    if (body.message && typeof body.message === "string") return body.message;
    return JSON.stringify(body);
  }
  return typeof body === "string" && body ? body : fallback;
}

export interface PGBHubClientConfig {
  /** PGBHub Cloud Endpoint URL (default: https://console.pgbhub.com or project URL) */
  endpoint?: string;
  /** PGBHub API Key or Access Token */
  apiKey?: string;
  /** Direct PostgreSQL Connection URL (optional for direct pooler connections) */
  dbUrl?: string;
  /** Database name target (default: postgres) */
  database?: string;
  /** Project ID — required by QueuesClient, whose routes are addressed by project rather than database.
   *  When no `endpoint` is given it also selects the project's own address, https://<projectId>.pgbhub.app. */
  projectId?: string;
  /** Per-request timeout in milliseconds (default 30000; 0 disables). */
  timeoutMs?: number;
  /** How many times a read (GET/HEAD) is retried after a network error, timeout, 429, 502, 503 or 504 (default 2). Writes are never retried automatically. */
  maxRetries?: number;
  /** Base delay between retries in milliseconds (default 300, doubled each attempt; a Retry-After header wins). */
  retryDelayMs?: number;
  /** A fetch implementation to use instead of the global one (tests, edge runtimes). */
  fetch?: typeof fetch;
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
  /** How many of the action's effects were queued to run after the SQL committed. */
  effects_queued?: number;
  /** On a dry run: what each effect would have done for this input (nothing is run). */
  effects_preview?: Array<{ type: string; would_run: Record<string, unknown> }>;
  message?: string;
}

/**
 * Something an action does after its SQL commits. Each effect is recorded in the
 * same transaction as the SQL and then delivered reliably (retried if it fails),
 * so repeating one must be safe. String values may use `{{params.name}}` (an
 * input) and `{{results.0.id}}` (a value the SQL returned).
 */
export type ActionEffect =
  | { type: "function"; name: string; payload?: unknown }
  | { type: "queue"; queue: string; payload?: unknown; delay_seconds?: number }
  | { type: "mail"; to: string; subject: string; text?: string; html?: string }
  | { type: "event"; event: string; payload?: unknown }
  | { type: "job"; job_type: string; target: { type: string; [key: string]: unknown }; payload?: unknown }
  | { type: "realtime"; channel: string; event: string; payload?: unknown }
  | { type: "container"; name: string; path?: string; method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; payload?: unknown; headers?: Record<string, string> }
  | { type: "action"; name: string; params?: Record<string, unknown> }
  | { type: "webhook"; url: string; payload?: unknown };

export interface ActionDefinition {
  name: string;
  title: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  sample_params: Record<string, unknown>;
  effects: ActionEffect[];
  /** True when the action has a legacy webhook URL (the URL itself is never returned). */
  has_webhook: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface RegisterActionOptions {
  name: string;
  /** The SQL, using `%(param)s` placeholders. */
  sql: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  sampleParams?: Record<string, unknown>;
  effects?: ActionEffect[];
  webhookUrl?: string;
}

export interface ActionDelivery {
  id: number;
  action: string;
  /** The effect's type, or "webhook" for the legacy webhook. */
  effect: string;
  status: "pending" | "dispatched" | "failed";
  attempts: number;
  error: string | null;
  created_at: string | null;
  delivered_at: string | null;
  next_attempt_at: string | null;
}

/** Management methods on `pgb.actions`. Prefixed with `$` so they can never collide with the name of an action you call. */
export interface ActionsManagement {
  /** Every action, with its inputs, sample parameters and effects. */
  $list(): Promise<ActionDefinition[]>;
  $get(name: string): Promise<ActionDefinition>;
  /** Create or update an action. Effects are validated by the server; a mistake comes back as a PGBError (400) saying what to fix. */
  $register(options: RegisterActionOptions): Promise<{ status: string; action: string; effects: ActionEffect[] }>;
  $delete(name: string): Promise<void>;
  /** Same as `pgb.actions.<name>(params)`, for names held in a variable. */
  $run<T = unknown>(name: string, params?: Record<string, unknown>, options?: ActionInvokeOptions): Promise<ActionResponse<T>>;
  /** What the actions' effects did: delivered, waiting, or failed (with the reason). */
  $deliveries(filter?: { action?: string; status?: "pending" | "dispatched" | "failed"; limit?: number }): Promise<ActionDelivery[]>;
  /** Put a failed delivery back in the queue. */
  $retryDelivery(id: number): Promise<void>;
}

export type ActionInvoker = (params?: Record<string, unknown>, opts?: ActionInvokeOptions) => Promise<ActionResponse>;

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
    const res = await this.client.http(url, {
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
      throw new PGBError(`PGB SQL query error [${res.status}]: ${errText}`, { status: res.status });
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
  /** Present instead of user/session when the account has two-factor on — finish with `auth.verifyMfa()`. */
  mfa_required?: boolean;
  challenge_token?: string;
  expires_in?: number;
  message?: string;
}

/**
 * What `signUp` returns. Normally a signed-in session. When the project requires
 * a verified email, or the sign-up had no password, there is no session yet:
 * `verification_required` is true and the user finishes by redeeming the code or
 * link that was emailed to them.
 */
export type SignUpResult =
  | AuthResult
  | { verification_required: true; user: Pick<AuthUser, "id" | "email"> & Partial<AuthUser>; message?: string; expires_in?: number; session?: undefined };

export interface AuthSessionInfo {
  id: string;
  device_label: string;
  ip?: string | null;
  created_at?: string;
  expires_at?: string;
  is_current: boolean;
}

export interface AuthEvent {
  id?: string | number;
  event_type: string;
  ip?: string | null;
  device_label?: string | null;
  created_at?: string;
  metadata?: Record<string, any>;
}

export interface MfaEnrollment {
  /** Base32 secret for manual entry in an authenticator app. */
  secret: string;
  /** otpauth:// URI to show as a QR code. */
  provisioning_uri: string;
}

export interface AuthSettings {
  signups_enabled: boolean;
  methods: { password: boolean; otp: boolean; magic_link: boolean };
  oauth_providers: string[];
  email_verification_required: boolean;
  password_policy: { min_length: number; require_uppercase: boolean; require_number: boolean; require_symbol: boolean };
  allow_self_delete: boolean;
  access_token_ttl_seconds: number;
  /** Extra sign-up fields the project asks for (username, name, user type, ...). Send their values as `metadata` on `signUp()`. */
  signup_fields: SignupField[];
}

export interface SignupField {
  key: string;
  label: string;
  type: "text" | "long_text" | "number" | "boolean" | "select";
  required: boolean;
  /** False means it is set at sign-up and the user can't change it later. */
  editable: boolean;
  help?: string;
  /** For `select` fields. */
  options?: string[];
  min_length?: number;
  max_length?: number;
  min?: number;
  max?: number;
}

export type OAuthProvider = "google" | "github";

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

  private async send<T = any>(method: string, path: string, body?: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Promise<T> {
    const res = await this.client.http(`${this.client.endpoint}${path}`, {
      method,
      headers: this.headers(extraHeaders),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const retryAfter = Number(res.headers?.get?.("retry-after"));
      throw new PGBError(`PGBHub Auth ${path} failed [${res.status}]: ${errorMessageFrom(data)}`, {
        status: res.status,
        code: typeof data?.code === "string" ? data.code : undefined,
        body: data,
        retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      });
    }
    return data as T;
  }

  private post<T = any>(path: string, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Promise<T> {
    return this.send<T>("POST", path, body, extraHeaders);
  }

  /** Headers carrying the signed-in user's token; throws if nobody is signed in. */
  private asUser(): Record<string, string> {
    const token = this.currentSession?.access_token;
    if (!token) throw new PGBError("PGBHub Auth: no signed-in user (sign in first, or call setSession()).", { status: 401, code: "not_signed_in" });
    return { "X-PGB-User-Token": token };
  }

  /** The project's sign-in rules (methods on, password policy, social providers), so a UI can adapt. No sign-in needed. */
  async getSettings(): Promise<AuthSettings> {
    return this.send<AuthSettings>("GET", "/auth/settings");
  }

  /**
   * Sign up a new user. With a password the user gets a verification email and,
   * unless the project requires verified email, a session straight away.
   * Without a password the sign-up is passwordless: a code is emailed and the
   * user finishes with `verifyOtp()`. Check `result.session` (or
   * `verification_required`) before assuming the user is signed in.
   * `redirectTo` must be allowed in the project's settings.
   */
  async signUp(options: { email: string; password?: string; metadata?: Record<string, any>; redirectTo?: string }): Promise<SignUpResult> {
    const result = await this.post<SignUpResult>("/auth/signup", {
      email: options.email,
      password: options.password,
      metadata: options.metadata || {},
      ...(options.redirectTo ? { redirect_to: options.redirectTo } : {}),
    });
    if (result.session) this.currentSession = result.session;
    return result;
  }

  /** Sign in with email & password. If the account has two-factor on, the result has `mfa_required` and no session: finish with `verifyMfa()`. */
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
    const res = await this.client.http(`${this.client.endpoint}/auth/user`, {
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

  // ── Passwordless ────────────────────────────────────────────────────────

  /** Email the user a 6-digit one-time code (valid 10 minutes). The code is never returned here: it is only emailed. */
  async requestOtp(options: { email: string }): Promise<{ message: string; expires_in: number }> {
    return this.post("/auth/otp", { email: options.email });
  }

  /** Redeem a one-time code and establish a session (also verifies the email). */
  async verifyOtp(options: { email: string; token: string }): Promise<AuthResult> {
    const result = await this.post<AuthResult>("/auth/otp/verify", { email: options.email, token: options.token });
    this.currentSession = result.session;
    return result;
  }

  /** Email the user a single-use magic link/token (valid 1 hour). The token is never returned here: it is only emailed. */
  async sendMagicLink(options: { email: string; redirectTo?: string }): Promise<{ message: string; expires_in: number }> {
    return this.post("/auth/magic", { email: options.email, ...(options.redirectTo ? { redirect_to: options.redirectTo } : {}) });
  }

  /** Redeem a magic-link token and establish a session (also verifies the email). */
  async verifyMagicLink(options: { token: string }): Promise<AuthResult> {
    const result = await this.post<AuthResult>("/auth/magic/verify", { token: options.token });
    this.currentSession = result.session;
    return result;
  }

  /** Email a fresh verification link to an account that isn't verified yet. Always succeeds, whether or not the address has an account. */
  async resendVerification(options: { email: string; redirectTo?: string }): Promise<{ message: string }> {
    return this.post("/auth/resend-verification", { email: options.email, ...(options.redirectTo ? { redirect_to: options.redirectTo } : {}) });
  }

  // ── Account recovery ────────────────────────────────────────────────────

  /** Email a password-reset code/link. Always succeeds, whether or not the address has an account. */
  async forgotPassword(options: { email: string; redirectTo?: string }): Promise<{ message: string }> {
    return this.post("/auth/forgot-password", { email: options.email, ...(options.redirectTo ? { redirect_to: options.redirectTo } : {}) });
  }

  /** Set a new password with the emailed token. Signs the user out of every session. */
  async resetPassword(options: { token: string; password: string }): Promise<{ message: string }> {
    return this.post("/auth/reset-password", { token: options.token, password: options.password });
  }

  // ── The signed-in user ──────────────────────────────────────────────────

  /** Change the signed-in user's password. Other sessions are signed out; this one stays. */
  async changePassword(options: { currentPassword?: string; newPassword: string }): Promise<{ message: string; sessions_revoked: number }> {
    return this.post("/auth/user/password", { current_password: options.currentPassword || "", new_password: options.newPassword }, this.asUser());
  }

  /** Merge values into the user's profile (`user_metadata`). A key set to null is removed. */
  async updateUser(options: { metadata: Record<string, any> }): Promise<{ user: AuthUser }> {
    return this.post("/auth/user/update", { user_metadata: options.metadata }, this.asUser());
  }

  /** Permanently delete the signed-in user's own account (needs their password, or a recent sign-in if they have none). */
  async deleteAccount(options: { password?: string } = {}): Promise<{ message: string }> {
    const result = await this.post<{ message: string }>("/auth/user/delete", { password: options.password || "" }, this.asUser());
    this.currentSession = null;
    return result;
  }

  /** The user's recent sign-ins and security events. */
  async getEvents(): Promise<AuthEvent[]> {
    const data = await this.send<{ events: AuthEvent[] }>("GET", "/auth/user/events", undefined, this.asUser());
    return data.events || [];
  }

  // ── Sessions ────────────────────────────────────────────────────────────

  /** The user's active sessions (devices). `is_current` marks this one. */
  async listSessions(): Promise<AuthSessionInfo[]> {
    const data = await this.send<{ sessions: AuthSessionInfo[] }>("GET", "/auth/sessions", undefined, this.asUser());
    return data.sessions || [];
  }

  /** Sign out one session (for example an old phone). */
  async revokeSession(sessionId: string): Promise<void> {
    await this.send("DELETE", `/auth/sessions/${encodeURIComponent(sessionId)}`, undefined, this.asUser());
  }

  /** Sign out every session except this one. Returns how many were ended. */
  async revokeOtherSessions(): Promise<number> {
    const data = await this.post<{ revoked: number }>("/auth/sessions/revoke-all", {}, this.asUser());
    return data.revoked;
  }

  // ── Two-factor authentication (authenticator app) ───────────────────────

  /** Start enrolment: show `provisioning_uri` as a QR code (or `secret` as text), then call `confirmMfa()`. */
  async enrollMfa(): Promise<MfaEnrollment> {
    return this.post("/auth/mfa/enroll", {}, this.asUser());
  }

  /** Confirm enrolment with a current code. Returns one-time backup codes: show them once. */
  async confirmMfa(options: { code: string }): Promise<{ enabled: true; backup_codes: string[] }> {
    return this.post("/auth/mfa/confirm", { code: options.code }, this.asUser());
  }

  /** Turn two-factor off. Needs a current authenticator or backup code. */
  async disableMfa(options: { code: string }): Promise<{ enabled: false }> {
    return this.post("/auth/mfa/disable", { code: options.code }, this.asUser());
  }

  /** Finish a sign-in that returned `mfa_required`, with an authenticator or backup code. */
  async verifyMfa(options: { challengeToken: string; code: string }): Promise<AuthResult> {
    const result = await this.post<AuthResult>("/auth/mfa/verify", { challenge_token: options.challengeToken, code: options.code });
    this.currentSession = result.session;
    return result;
  }

  // ── Social login ────────────────────────────────────────────────────────

  /** Get the provider's sign-in URL. Send the user there; the provider returns them to `redirectUri` with `code` and `state`. */
  async oauthStart(options: { provider: OAuthProvider; redirectUri: string }): Promise<{ authorize_url: string; state: string }> {
    return this.send("GET", `/auth/oauth/${encodeURIComponent(options.provider)}/start?redirect_uri=${encodeURIComponent(options.redirectUri)}`);
  }

  /** Exchange the `code` and `state` the provider returned for a session. */
  async oauthCallback(options: { provider: OAuthProvider; code: string; state: string; redirectUri: string }): Promise<AuthResult> {
    const result = await this.post<AuthResult>(`/auth/oauth/${encodeURIComponent(options.provider)}/callback`, {
      code: options.code,
      state: options.state,
      redirect_uri: options.redirectUri,
    });
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
    const res = await this.client.http(`${this.client.endpoint}${path}`, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      throw new PGBError(`PGBHub Auth Admin ${method} ${path} failed [${res.status}]: ${data.error || JSON.stringify(data)}`, { status: res.status });
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

/** Who can read a bucket's objects. Buckets are public unless made private. */
export type BucketVisibility = "public" | "private";

export interface CreateSignedUrlOptions {
  /** "GET" to download (the default; also answers HEAD) or "PUT" to upload. */
  method?: "GET" | "PUT";
  /** Lifetime in seconds. Default 900 (15 minutes); at most 86400 for GET and 3600 for PUT. */
  expiresIn?: number;
  /** PUT only: the upload must use exactly this Content-Type. Needed to allow HTML, SVG, XML or JavaScript. */
  contentType?: string;
}

/** A signed URL for one object and one method, from `storage.createSignedUrl()`. */
export interface SignedUrl {
  /** The full URL on the project's own address. Anyone holding it can use it until it expires. */
  url: string;
  /** The URL's path (`/storage/_signed/<token>`). */
  path: string;
  method: "GET" | "PUT";
  bucket: string;
  file_path: string;
  expires_in: number;
  /** Unix time (seconds) when the URL stops working. */
  expires_at: number;
  /** The Content-Type a PUT is bound to, or null. */
  content_type: string | null;
  bucket_visibility: BucketVisibility;
  [key: string]: unknown;
}

export interface SignedUploadResult {
  success: boolean;
  bucket: string;
  file_path: string;
  size_bytes: number;
  [key: string]: unknown;
}

export interface BucketVisibilityChange {
  success: boolean;
  bucket: string;
  visibility: BucketVisibility;
  previous_visibility: BucketVisibility;
  /** Present when a public bucket went private: copies already cached by browsers or the CDN are not recalled. */
  note?: string;
  [key: string]: unknown;
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
    const presignRes = await this.client.http(`${this.client.endpoint}/storage/upload`, {
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
        const putRes = await this.client.http(presignData.upload_url, {
          method: "PUT",
          headers: {
            "Content-Type": options.contentType || "application/octet-stream",
          },
          body: data,
        });
        if (!putRes.ok) throw new PGBError(`Failed to upload file to R2 [${putRes.status}]`, { status: putRes.status });
        return {
          path: cleanPath,
          url: presignData.public_url || this.getPublicUrl(cleanPath),
        };
      }
    }

    // Direct upload fallback
    const directRes = await this.client.http(`${this.client.endpoint}/storage/${cleanPath}`, {
      method: "PUT",
      headers: {
        "Content-Type": options.contentType || "application/octet-stream",
        ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
      },
      body: data,
    });
    if (!directRes.ok) throw new PGBError(`Storage upload failed [${directRes.status}]: ${await directRes.text()}`, { status: directRes.status });
    return {
      path: cleanPath,
      url: this.getPublicUrl(cleanPath),
    };
  }

  /**
   * The public URL of an asset. It does not work for objects in a private
   * bucket: those are readable only with the project's secret key or a signed
   * URL (see `createSignedUrl`).
   */
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
    const res = await this.client.http(`${this.client.endpoint}/storage/delete`, {
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
    const res = await this.client.http(`${this.client.endpoint}/storage/list${query}`, {
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
    const res = await this.client.http(`${this.client.endpoint}/storage/${cleanPath}`, {
      headers: {
        Accept: "*/*",
        ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
      },
    });
    if (!res.ok) {
      throw new PGBError(`Storage getFile('${filePath}') failed [${res.status}]: ${await res.text()}`, { status: res.status });
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

  /**
   * The project these bucket calls address: `projectId` when configured,
   * otherwise the slug in a `https://<slug>.pgbhub.app` endpoint.
   */
  private projectRef(): string {
    if (this.client.projectId) return this.client.projectId;
    const domain = (typeof process !== "undefined" ? process.env?.PGBHUB_PROJECT_DOMAIN : undefined) || "pgbhub.app";
    let host = "";
    try { host = new URL(this.client.endpoint).hostname.toLowerCase(); } catch { /* not a URL */ }
    if (host.endsWith(`.${domain}`)) {
      const slug = host.slice(0, -(domain.length + 1));
      if (slug && !slug.includes(".")) return slug;
    }
    throw new Error("Bucket management needs the project: pass { projectId } to createClient(), set PGBHUB_PROJECT_ID, or use the project's address (https://<slug>.pgbhub.app) as the endpoint.");
  }

  /**
   * A signed URL for one object: GET to download it (also from a private
   * bucket), PUT to upload it. Calls `POST /storage/sign` on the project's
   * address and needs the project's **secret** key (`pgb_sec_...`), so call it
   * on a server and hand only the URL to the browser or end user.
   */
  async createSignedUrl(bucket: string, path: string, options: CreateSignedUrlOptions = {}): Promise<SignedUrl> {
    const method = (options.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "PUT") throw new Error(`createSignedUrl: method must be "GET" or "PUT", not "${options.method}".`);
    if (options.contentType && method !== "PUT") throw new Error("createSignedUrl: contentType applies only to PUT (upload) URLs.");
    return this.client.api<SignedUrl>("POST", "/storage/sign", {
      body: {
        bucket,
        path: path.replace(/^\/+/, ""),
        method,
        ...(options.expiresIn !== undefined ? { expires_in: options.expiresIn } : {}),
        ...(options.contentType ? { content_type: options.contentType } : {}),
      },
    });
  }

  /**
   * Upload bytes to a signed PUT URL from `createSignedUrl(..., { method: "PUT" })`.
   * No API key is sent: the URL is the credential. If the URL was minted with a
   * `contentType`, pass the same one.
   */
  async uploadToSignedUrl(url: string, body: BodyInit | Uint8Array | ArrayBuffer | Blob | string, contentType = "application/octet-stream"): Promise<SignedUploadResult> {
    const target = url.startsWith("/") ? `${this.client.endpoint}${url}` : url;
    const res = await this.client.http(target, {
      method: "PUT",
      headers: { "Content-Type": contentType, Accept: "application/json" },
      body: body as BodyInit,
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      throw new PGBError(`Signed upload failed [${res.status}]: ${errorMessageFrom(data)}`, { status: res.status, body: data });
    }
    return data as SignedUploadResult;
  }

  /**
   * Create a bucket. Visibility defaults to "public", as every bucket was
   * before private buckets existed. Needs the project's secret key (or an
   * account key with storage rights).
   */
  async createBucket(name: string, options: { visibility?: BucketVisibility } = {}): Promise<{ success: boolean; bucket: string; visibility: BucketVisibility }> {
    return this.client.api("POST", `/api/v1/projects/${encodeURIComponent(this.projectRef())}/storage/buckets`, {
      body: { name, visibility: options.visibility || "public" },
    });
  }

  /**
   * Make a bucket private, or public. Going private is enforced within
   * seconds, but copies a browser or the CDN already fetched are not recalled.
   * Going public exposes every object in the bucket, so it needs
   * `{ confirmPublic: true }`; without it this throws and sends nothing.
   */
  async setBucketVisibility(name: string, visibility: BucketVisibility, options: { confirmPublic?: boolean } = {}): Promise<BucketVisibilityChange> {
    if (visibility !== "public" && visibility !== "private") throw new Error(`setBucketVisibility: visibility must be "public" or "private", not "${visibility}".`);
    if (visibility === "public" && options.confirmPublic !== true) {
      throw new Error(`setBucketVisibility: making bucket '${name}' public exposes every object in it to anyone with its URL. Pass { confirmPublic: true } to proceed.`);
    }
    return this.client.api<BucketVisibilityChange>("POST", `/api/v1/projects/${encodeURIComponent(this.projectRef())}/storage/buckets/${encodeURIComponent(name)}/visibility`, {
      body: { visibility, ...(visibility === "public" ? { confirm_public: true } : {}) },
    });
  }
}

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  /** One address for the Reply-To header. The server refuses line breaks, commas and semicolons (400). */
  replyTo?: string;
}

/** `PGBError.code` when the platform has no mail provider configured (HTTP 503). */
export const MAIL_PROVIDER_UNAVAILABLE = "MAIL_PROVIDER_UNAVAILABLE";

export interface MailSendResult {
  success: boolean;
  /** The sent message's id. Filled from `mail_id` when an older server returns only that. */
  message_id?: string;
  /** Older name for `message_id`; same value. */
  mail_id?: string;
  to?: string;
  from?: string;
  provider?: string;
  status?: string;
  /** Present only when `to` had more than one recipient (see note below). */
  results?: Array<{ to: string; success: boolean; message_id?: string; error?: string; code?: string }>;
  [key: string]: unknown;
}

/**
 * Transactional Mail Client
 */
export class MailClient {
  constructor(private readonly client: PGBHubClientCore) {}

  private async sendOne(options: SendMailOptions, to: string): Promise<MailSendResult> {
    const payload: Record<string, unknown> = {
      to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      from: options.from,
    };
    if (options.replyTo) payload.reply_to = options.replyTo;
    const res = await this.client.http(`${this.client.endpoint}/mail/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let data: any = raw;
      try {
        data = raw ? JSON.parse(raw) : undefined;
      } catch {
        // not JSON: keep the raw text
      }
      const code = data && typeof data === "object" && typeof data.code === "string" ? data.code : undefined;
      const retryAfter = Number(res.headers?.get?.("retry-after"));
      throw new PGBError(`Mail send to ${to} failed [${res.status}]: ${errorMessageFrom(data, raw)}`, {
        status: res.status,
        code,
        body: data,
        retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      });
    }
    const result = ((await res.json().catch(() => ({}))) || {}) as MailSendResult;
    if (result.message_id === undefined && result.mail_id !== undefined) result.message_id = result.mail_id;
    return result;
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
   *
   * A failed send throws `PGBError` with the HTTP `status` and the server's
   * `code`; with no mail provider configured that is 503 and
   * `MAIL_PROVIDER_UNAVAILABLE`.
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
          return {
            to,
            success: false,
            error: err instanceof Error ? err.message : String(err),
            ...(err instanceof PGBError && err.code ? { code: err.code } : {}),
          };
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
    let res = await this.client.http(projectUrl, {
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
      res = await this.client.http(fallbackUrl, {
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
      throw new PGBError(`Function '${functionName}' invocation failed [${res.status}]: ${err}`, { status: res.status });
    }
    return res.json() as Promise<T>;
  }

  /** List all configured cloud functions */
  async list(): Promise<any[]> {
    const url = `${this.client.endpoint}/api/v1/databases/${encodeURIComponent(this.client.database)}/functions`;
    const res = await this.client.http(url, {
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
    const res = await this.client.http(url, {
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
      throw new PGBError(`Function deploy '${name}' failed [${res.status}]: ${data.error || JSON.stringify(data)}`, { status: res.status });
    }
    return data.function ?? data;
  }

  /** Delete a cloud function */
  async delete(name: string): Promise<boolean> {
    const url = `${this.client.endpoint}/api/v1/databases/${encodeURIComponent(this.client.database)}/functions/${encodeURIComponent(name)}`;
    const res = await this.client.http(url, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new PGBError(`Function delete '${name}' failed [${res.status}]: ${data.error || JSON.stringify(data)}`, { status: res.status });
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
      throw new PGBError(`Cron ${label} failed [${res.status}]: ${data.error || JSON.stringify(data)}`, { status: res.status });
    }
    return data as T;
  }

  /** List scheduled cron jobs */
  async list(): Promise<CronJob[]> {
    const res = await this.client.http(this.base, { headers: this.headers() });
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
    const res = await this.client.http(this.base, {
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
    const res = await this.client.http(`${this.base}/${encodeURIComponent(cronId)}/toggle`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ enabled }),
    });
    return this.handle<CronJob>(res, "toggle");
  }

  /** Manually trigger a cron job to run immediately */
  async run(cronId: string): Promise<Record<string, unknown>> {
    const res = await this.client.http(`${this.base}/${encodeURIComponent(cronId)}/run`, {
      method: "POST",
      headers: this.headers(),
    });
    return this.handle(res, "run");
  }

  /** Delete a cron job */
  async delete(cronId: string): Promise<{ deleted: boolean; id: string }> {
    const res = await this.client.http(`${this.base}/${encodeURIComponent(cronId)}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    return this.handle(res, "delete");
  }

  /** List recent run history for a cron job */
  async listRuns(cronId: string, limit: number = 50): Promise<CronRun[]> {
    const res = await this.client.http(`${this.base}/${encodeURIComponent(cronId)}/runs?limit=${limit}`, {
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

    const res = await this.client.http(`${this.base}/${encodeURIComponent(cronId)}`, {
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
      throw new PGBError(`Jobs ${label} failed [${res.status}]: ${data.error || JSON.stringify(data)}`, { status: res.status });
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
    const res = await this.client.http(this.base, {
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
    const res = await this.client.http(`${this.base}/${jobId}`, { headers: this.headers() });
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
    const res = await this.client.http(`${this.base}${qs}`, { headers: this.headers() });
    const data = await this.handle<{ success: boolean; jobs: BackgroundJob[]; total: number }>(res, "list");
    return data.jobs || [];
  }

  /** Cancel a pending/running job. Returns false if it could not be cancelled (already running or finished). */
  async cancel(jobId: number): Promise<boolean> {
    const res = await this.client.http(`${this.base}/${jobId}/cancel`, { method: "POST", headers: this.headers() });
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
      throw new PGBError(`Queues ${label} failed [${res.status}]: ${data.error || JSON.stringify(data)}`, { status: res.status });
    }
    return data as T;
  }

  private url(queueName: string, action: string): string {
    return `${this.client.endpoint}/api/v1/projects/${encodeURIComponent(this.requireProjectId())}/queues/${encodeURIComponent(queueName)}/${action}`;
  }

  /** Send a message to a queue */
  async send(queueName: string, payload: unknown, options: SendMessageOptions = {}): Promise<SentMessage> {
    const res = await this.client.http(this.url(queueName, "send"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ payload, delay_seconds: options.delaySeconds, deduplication_id: options.deduplicationId }),
    });
    const data = await this.handle<{ ok: boolean; message: SentMessage }>(res, "send");
    return data.message;
  }

  /** Receive (and lease) messages from a queue */
  async receive(queueName: string, options: ReceiveMessagesOptions = {}): Promise<ReceivedMessage[]> {
    const res = await this.client.http(this.url(queueName, "receive"), {
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
    const res = await this.client.http(this.url(queueName, "ack"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ message_id: messageId }),
    });
    const data = await this.handle<{ ok: boolean }>(res, "ack");
    return !!data.ok;
  }

  /** Negatively acknowledge a message — returns it to the queue (or to the DLQ past max retries) */
  async nack(queueName: string, messageId: string, error?: string): Promise<boolean> {
    const res = await this.client.http(this.url(queueName, "nack"), {
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
    const res = await this.client.http(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ channel, event: options.event || "message", payload, sender_id: options.senderId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new PGBError(`Realtime broadcast failed [${res.status}]: ${data.error || JSON.stringify(data)}`, { status: res.status });
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
        const res = await this.client.http(url, {
          headers: { Accept: "text/event-stream", ...this.headers() },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new PGBError(`Realtime subscribe failed [${res.status}]`, { status: res.status });
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
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  /** True when the caller named a database; otherwise requests leave it out and the server uses the one the API key belongs to. */
  private readonly databaseExplicit: boolean;
  private readonly fetchImpl?: typeof fetch;

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

  /** Call an action by name (`pgb.actions.saveUser({ ... })`), or manage actions and their effects with the `$` methods (`pgb.actions.$list()`). */
  readonly actions: ActionsManagement & Record<string, ActionInvoker>;

  constructor(config: PGBHubClientConfig = {}) {
    const env = (name: string): string | undefined => (typeof process !== "undefined" ? process.env?.[name] : undefined);
    this.projectId = config.projectId || env("PGBHUB_PROJECT_ID");
    const projectDomain = env("PGBHUB_PROJECT_DOMAIN") || "pgbhub.app";
    this.endpoint = (
      config.endpoint ||
      env("PGBHUB_ENDPOINT") ||
      env("PGBHUB_PROJECT_URL") ||
      (this.projectId ? `https://${this.projectId}.${projectDomain}` : "https://console.pgbhub.com")
    ).replace(/\/$/, "");
    this.apiKey = config.apiKey || env("PGBHUB_API_KEY") || env("PGBHUB_PUBLISHABLE_KEY");
    this.dbUrl = config.dbUrl || env("DATABASE_URL");
    const explicitDb = config.database || env("PGBHUB_DATABASE");
    this.database = explicitDb || "postgres";
    this.databaseExplicit = !!explicitDb;
    this.timeoutMs = config.timeoutMs ?? 30000;
    this.maxRetries = config.maxRetries ?? 2;
    this.retryDelayMs = config.retryDelayMs ?? 300;
    this.fetchImpl = config.fetch;

    // Dynamic JavaScript Proxy handler for actions sub-property: any name is an
    // action to call, except the `$`-prefixed management methods.
    const management: ActionsManagement = {
      $list: async () => (await this.api<{ actions: ActionDefinition[] }>("GET", "/v1/actions")).actions,
      $get: (name) => this.api<ActionDefinition>("GET", `/v1/actions/${encodeURIComponent(name)}`),
      $register: (o) =>
        this.api("POST", "/v1/actions/register", {
          body: {
            name: o.name,
            sql_template: o.sql,
            title: o.title,
            description: o.description || "",
            input_schema: o.inputSchema,
            output_schema: o.outputSchema,
            sample_params: o.sampleParams,
            effects: o.effects,
            webhook_url: o.webhookUrl,
          },
        }),
      $delete: async (name) => {
        await this.api("DELETE", `/v1/actions/${encodeURIComponent(name)}`);
      },
      $run: (name, params = {}, options = {}) => this.invokeAction(name, params, options),
      $deliveries: async (filter = {}) =>
        (await this.api<{ deliveries: ActionDelivery[] }>("GET", "/v1/actions/deliveries", {
          query: { action: filter.action, status: filter.status, limit: filter.limit },
        })).deliveries,
      $retryDelivery: async (id) => {
        await this.api("POST", `/v1/actions/deliveries/${encodeURIComponent(String(id))}/retry`, { body: {} });
      },
    };
    this.actions = new Proxy({} as any, {
      get: (_target, prop: string | symbol) => {
        if (typeof prop !== "string") return undefined;
        if (prop.startsWith("$")) return (management as any)[prop];
        return (params: Record<string, unknown> = {}, opts: ActionInvokeOptions = {}) => this.invokeAction(prop, params, opts);
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

  /**
   * The one place every request goes through: applies the timeout, and retries
   * reads (GET/HEAD) on a network error, timeout, 429, 502, 503 or 504, honouring
   * Retry-After. Writes are sent once, because repeating one could repeat its effect.
   * A transport failure is thrown as a PGBError with code "network_error" or "timeout".
   */
  async http(url: string, init: RequestInit = {}): Promise<Response> {
    const method = String(init.method || "GET").toUpperCase();
    const idempotent = method === "GET" || method === "HEAD";
    const attempts = idempotent ? this.maxRetries + 1 : 1;
    const doFetch: typeof fetch = this.fetchImpl || ((...a) => globalThis.fetch(...a));
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const backoff = (i: number) => this.retryDelayMs * 2 ** i * (0.75 + Math.random() * 0.5);

    for (let i = 0; i < attempts; i++) {
      const last = i === attempts - 1;
      const signal =
        init.signal ??
        (this.timeoutMs > 0 && typeof AbortSignal !== "undefined" && typeof (AbortSignal as any).timeout === "function"
          ? (AbortSignal as any).timeout(this.timeoutMs)
          : undefined);
      try {
        const res = await doFetch(url, signal ? { ...init, signal } : init);
        if (!last && [429, 502, 503, 504].includes(res.status)) {
          const ra = Number(res.headers?.get?.("retry-after"));
          await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : backoff(i));
          continue;
        }
        return res;
      } catch (err: any) {
        if (!last) {
          await sleep(backoff(i));
          continue;
        }
        const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
        throw new PGBError(
          timedOut ? `PGBHub request timed out after ${this.timeoutMs}ms: ${method} ${url}` : `PGBHub request failed (network error): ${method} ${url}: ${err?.message || err}`,
          { code: timedOut ? "timeout" : "network_error" },
        );
      }
    }
    throw new PGBError(`PGBHub request failed: ${method} ${url}`, { code: "network_error" });
  }

  /**
   * JSON request to any PGBHub API path with the key attached. A database is
   * only named when you configured one, otherwise the server uses the one the
   * key belongs to. Failures are thrown as PGBError with the server's message.
   */
  async api<R = unknown>(method: string, path: string, options: { body?: Record<string, unknown>; query?: Record<string, string | number | undefined> } = {}): Promise<R> {
    const params = new URLSearchParams();
    if (this.databaseExplicit) params.set("dbname", this.database);
    for (const [k, v] of Object.entries(options.query || {})) if (v !== undefined && v !== "") params.set(k, String(v));
    const qs = params.toString();
    const url = `${this.endpoint}${path.startsWith("/") ? path : `/${path}`}${qs ? `?${qs}` : ""}`;
    const res = await this.http(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const retryAfter = Number(res.headers?.get?.("retry-after"));
      throw new PGBError(`PGBHub request to ${path} failed [${res.status}]: ${errorMessageFrom(data)}`, {
        status: res.status,
        code: typeof data?.code === "string" ? data.code : undefined,
        body: data,
        retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      });
    }
    return data as R;
  }

  /** Generic authenticated API request helper */
  async request<R = unknown>(path: string, body: Record<string, unknown>): Promise<R> {
    const url = `${this.endpoint}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await this.http(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(this.databaseExplicit ? { ...body, dbname: this.database } : { ...body }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      let parsed: unknown;
      try { parsed = JSON.parse(errorText); } catch { parsed = undefined; }
      throw new PGBError(`PGBHub request to ${path} failed [${res.status}]: ${errorText}`, { status: res.status, body: parsed });
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
    const res = await this.http(url, {
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
      throw new PGBError(`createDatabase('${name}') failed [${res.status}]: ${data.error || JSON.stringify(data)}`, { status: res.status });
    }
    return data;
  }

  /** Fetch the structured machine-readable /schema.json metadata */
  async getSchema(): Promise<SchemaJson> {
    const url = `${this.endpoint}/api/v1/databases/${encodeURIComponent(this.database)}/schema.json`;
    const res = await this.http(url, {
      headers: {
        Accept: "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
    });
    if (!res.ok) {
      throw new PGBError(`Failed to fetch schema: ${res.status} ${res.statusText}`, { status: res.status });
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
      const domain = (typeof process !== "undefined" ? process.env?.PGBHUB_PROJECT_DOMAIN : undefined) || "pgbhub.app";
      endpoint = `https://${endpoint}.${domain}`;
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
