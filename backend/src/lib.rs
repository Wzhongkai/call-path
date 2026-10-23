mod validation;

use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use axum::{
    Extension, Json, Router,
    extract::{ConnectInfo, DefaultBodyLimit, Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use rand::{RngCore, rngs::OsRng};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use std::{
    collections::HashMap,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Semaphore;
use tower_http::services::ServeDir;

const COOKIE: &str = "callpath_session";
const SESSION_SECONDS: i64 = 7 * 24 * 3600;
const MAX_WORKSPACE: usize = 20 * 1024 * 1024;

#[derive(Clone)]
pub struct Config {
    pub bind: String,
    pub public_origin: String,
    pub database: PathBuf,
    pub static_dir: PathBuf,
    pub registration: bool,
    pub secure_cookie: bool,
    pub base_path: String,
}
impl Config {
    pub fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        let env =
            |key: &str, fallback: &str| std::env::var(key).unwrap_or_else(|_| fallback.into());
        let origin = env("PUBLIC_ORIGIN", "http://127.0.0.1:8080")
            .trim_end_matches('/')
            .to_owned();
        let uri: axum::http::Uri = origin.parse()?;
        if uri.authority().is_none()
            || uri.path() != "/"
            || uri.query().is_some()
            || !matches!(uri.scheme_str(), Some("http" | "https"))
        {
            return Err("PUBLIC_ORIGIN must be an http(s) origin without a path".into());
        }
        let secure_cookie = origin.starts_with("https://");
        if !secure_cookie
            && !matches!(uri.host(), Some("localhost" | "127.0.0.1" | "[::1]"))
            && env("ALLOW_INSECURE_HTTP", "false") != "true"
        {
            return Err(
                "public HTTP requires explicit ALLOW_INSECURE_HTTP=true; use HTTPS for deployment"
                    .into(),
            );
        }
        let base_path = env("BASE_PATH", "").trim_end_matches('/').to_owned();
        if !base_path.is_empty()
            && (!base_path.starts_with('/')
                || base_path.split('/').skip(1).any(|part| {
                    part.is_empty()
                        || !part
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
                }))
        {
            return Err("BASE_PATH must be empty or a path such as /code".into());
        }
        Ok(Self {
            bind: env("BIND", "127.0.0.1:8080"),
            public_origin: origin,
            database: env("DATABASE_PATH", "data/callpath.sqlite3").into(),
            static_dir: env("STATIC_DIR", "dist").into(),
            registration: env("ALLOW_REGISTRATION", "false") == "true",
            secure_cookie,
            base_path,
        })
    }
}

#[derive(Clone)]
pub struct AppState(Arc<Inner>);
struct Inner {
    db: SqlitePool,
    config: Config,
    attempts: Mutex<HashMap<String, (i64, u32)>>,
    hashing: Arc<Semaphore>,
    dummy_hash: String,
}

#[derive(Debug)]
pub struct ApiError(StatusCode, String);
impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.1)
    }
}
impl std::error::Error for ApiError {}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}
impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        tracing::error!(%error, "database operation failed");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "服务器保存失败，请稍后重试".into(),
        )
    }
}
fn bad(message: &str) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, message.into())
}
fn unauthorized() -> ApiError {
    ApiError(StatusCode::UNAUTHORIZED, "登录已过期，请重新登录".into())
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}
fn random_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn token_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

pub async fn open_state(config: Config) -> Result<AppState, Box<dyn std::error::Error>> {
    if let Some(parent) = config
        .database
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }
    let options = SqliteConnectOptions::new()
        .filename(&config.database)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(10));
    let db = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;
    let schema_version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&db)
        .await?;
    if schema_version > 1 {
        return Err(
            "Database schema is newer than this server; do not downgrade without a migration"
                .into(),
        );
    }
    sqlx::raw_sql(include_str!("../schema.sql"))
        .execute(&db)
        .await?;
    sqlx::query("DELETE FROM sessions WHERE expires_at <= ?")
        .bind(now())
        .execute(&db)
        .await?;
    let dummy_hash = tokio::task::spawn_blocking(|| hash_password(&random_token())).await??;
    Ok(AppState(Arc::new(Inner {
        db,
        config,
        attempts: Mutex::new(HashMap::new()),
        hashing: Arc::new(Semaphore::new(4)),
        dummy_hash,
    })))
}

pub fn router(state: AppState) -> Router {
    let auth = Router::new()
        .route("/me", get(me))
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/password", post(change_password))
        .layer(DefaultBodyLimit::max(4096));
    let api = Router::new()
        .route("/config", get(configuration))
        .route("/health", get(health))
        .nest("/auth", auth)
        .route("/workspace", get(load_workspace).put(save_workspace))
        .fallback(|| async { ApiError(StatusCode::NOT_FOUND, "接口不存在".into()) })
        .layer(DefaultBodyLimit::max(MAX_WORKSPACE + 1024 * 1024));
    Router::new()
        .nest("/api", api)
        .fallback_service(ServeDir::new(&state.0.config.static_dir))
        .layer(middleware::from_fn_with_state(state.clone(), security))
        .with_state(state)
}

async fn security(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let api = request.uri().path().starts_with("/api/");
    if api
        && !matches!(
            *request.method(),
            Method::GET | Method::HEAD | Method::OPTIONS
        )
    {
        // Custom headers force a CORS preflight; no cross-origin CORS permission is granted.
        if request
            .headers()
            .get("x-callpath-request")
            .and_then(|h| h.to_str().ok())
            != Some("1")
            || request
                .headers()
                .get(header::ORIGIN)
                .is_some_and(|h| h.to_str().ok() != Some(&state.0.config.public_origin))
        {
            return ApiError(
                StatusCode::FORBIDDEN,
                "请求来源不匹配，请从配置的站点地址访问".into(),
            )
            .into_response();
        }
    }
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("referrer-policy", HeaderValue::from_static("same-origin"));
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert("content-security-policy", HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"));
    response
}
async fn configuration(State(state): State<AppState>) -> Json<Value> {
    Json(
        json!({"backend":true,"registration":state.0.config.registration,"maxWorkspaceBytes":MAX_WORKSPACE}),
    )
}
async fn health(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    sqlx::query("SELECT 1").execute(&state.0.db).await?;
    Ok(Json(json!({"ok":true})))
}

fn normalized_username(name: &str) -> Result<String, ApiError> {
    let name = name.trim().to_ascii_lowercase();
    if !(3..=32).contains(&name.len())
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(bad("用户名需为 3–32 位字母、数字、下划线或短横线"));
    }
    Ok(name)
}
fn valid_password(password: &str) -> Result<(), ApiError> {
    if !(8..=128).contains(&password.chars().count()) || password.len() > 512 {
        return Err(bad("密码需要 8–128 个字符"));
    }
    Ok(())
}
fn hash_password(password: &str) -> Result<String, ApiError> {
    Argon2::default()
        .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
        .map(|hash| hash.to_string())
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "密码处理失败".into()))
}
async fn password_job<T: Send + 'static>(
    state: &AppState,
    job: impl FnOnce() -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    let permit = state
        .0
        .hashing
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "登录繁忙，请稍后重试".into()))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        job()
    })
    .await
    .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "密码处理失败".into()))?
}
pub async fn create_user(
    state: &AppState,
    username: &str,
    password: &str,
) -> Result<String, ApiError> {
    let username = normalized_username(username)?;
    valid_password(password)?;
    let password = password.to_owned();
    let hash = password_job(state, move || hash_password(&password)).await?;
    let id = random_token();
    let mut tx = state.0.db.begin().await?;
    let result =
        sqlx::query("INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)")
            .bind(&id)
            .bind(&username)
            .bind(hash)
            .bind(now())
            .execute(&mut *tx)
            .await;
    if let Err(error) = result {
        if error
            .as_database_error()
            .is_some_and(|e| e.is_unique_violation())
        {
            return Err(ApiError(StatusCode::CONFLICT, "用户名不可用".into()));
        }
        return Err(error.into());
    }
    sqlx::query("INSERT INTO workspaces (user_id,revision,updated_at) VALUES (?,0,?)")
        .bind(&id)
        .bind(now())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(id)
}
pub async fn reset_password(
    state: &AppState,
    username: &str,
    password: &str,
) -> Result<(), ApiError> {
    let name = normalized_username(username)?;
    valid_password(password)?;
    let password = password.to_owned();
    let hash = password_job(state, move || hash_password(&password)).await?;
    let mut tx = state.0.db.begin().await?;
    let result = sqlx::query("UPDATE users SET password_hash=? WHERE username=?")
        .bind(hash)
        .bind(&name)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(bad("用户不存在"));
    }
    sqlx::query("DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE username=?)")
        .bind(name)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}
fn throttle(
    state: &AppState,
    headers: &HeaderMap,
    peer: Option<Extension<ConnectInfo<SocketAddr>>>,
    name: &str,
) -> Result<(), ApiError> {
    let _ = headers; // Intentionally never trust client-controlled X-Forwarded-For.
    let ip = peer
        .map(|p| p.0.0.ip().to_string())
        .unwrap_or_else(|| "test".into());
    let now = now();
    let mut attempts = state.0.attempts.lock().unwrap();
    attempts.retain(|_, (start, _)| now - *start < 900);
    for (key, max) in [(format!("ip:{ip}"), 100), (format!("name:{name}"), 15)] {
        if attempts.len() >= 8192 {
            return Err(ApiError(
                StatusCode::TOO_MANY_REQUESTS,
                "请求过多，请稍后再试".into(),
            ));
        }
        let entry = attempts.entry(key).or_insert((now, 0));
        entry.1 += 1;
        if entry.1 > max {
            return Err(ApiError(
                StatusCode::TOO_MANY_REQUESTS,
                "尝试次数过多，请 15 分钟后再试".into(),
            ));
        }
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Credentials {
    username: String,
    password: String,
}
async fn register(
    State(state): State<AppState>,
    peer: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<Credentials>,
) -> Result<Response, ApiError> {
    if !state.0.config.registration {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "注册已关闭，请联系站点管理员创建账号".into(),
        ));
    }
    let name = normalized_username(&body.username)?;
    throttle(&state, &headers, peer, &name)?;
    let id = create_user(&state, &name, &body.password).await?;
    new_session(&state, &id, &name).await
}
async fn login(
    State(state): State<AppState>,
    peer: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<Credentials>,
) -> Result<Response, ApiError> {
    let name = normalized_username(&body.username)?;
    valid_password(&body.password)?;
    throttle(&state, &headers, peer, &name)?;
    let row = sqlx::query("SELECT id,password_hash FROM users WHERE username=?")
        .bind(&name)
        .fetch_optional(&state.0.db)
        .await?;
    let hash: String = row
        .as_ref()
        .map(|row| row.get("password_hash"))
        .unwrap_or_else(|| state.0.dummy_hash.clone());
    let verified = password_job(&state, move || {
        Ok(PasswordHash::new(&hash).is_ok_and(|hash| {
            Argon2::default()
                .verify_password(body.password.as_bytes(), &hash)
                .is_ok()
        }))
    })
    .await?;
    let row = row
        .filter(|_| verified)
        .ok_or_else(|| ApiError(StatusCode::UNAUTHORIZED, "用户名或密码错误".into()))?;
    new_session(&state, &row.get::<String, _>("id"), &name).await
}
fn session_cookie(state: &AppState, token: &str, age: i64) -> String {
    format!(
        "{COOKIE}={token}; HttpOnly; SameSite=Lax; Path={}/; Max-Age={age}{}",
        state.0.config.base_path,
        if state.0.config.secure_cookie {
            "; Secure"
        } else {
            ""
        }
    )
}
async fn new_session(
    state: &AppState,
    user_id: &str,
    username: &str,
) -> Result<Response, ApiError> {
    let token = random_token();
    let mut tx = state.0.db.begin().await?;
    sqlx::query("DELETE FROM sessions WHERE expires_at<=?")
        .bind(now())
        .execute(&mut *tx)
        .await?;
    // Bound retained sessions per account, keeping the newest nineteen before insertion.
    sqlx::query("DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 19)").bind(user_id).bind(user_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)")
        .bind(token_hash(&token))
        .bind(user_id)
        .bind(now() + SESSION_SECONDS)
        .bind(now())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    let mut response = Json(json!({"user":{"id":user_id,"username":username}})).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&session_cookie(state, &token, SESSION_SECONDS)).unwrap(),
    );
    Ok(response)
}
fn cookie_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|part| part.trim().strip_prefix(&format!("{COOKIE}=")))
        .filter(|token| token.len() == 64 && token.bytes().all(|b| b.is_ascii_hexdigit()))
}
async fn current_user(state: &AppState, headers: &HeaderMap) -> Result<(String, String), ApiError> {
    let token = cookie_token(headers).ok_or_else(unauthorized)?;
    let row = sqlx::query("SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?")
        .bind(token_hash(token)).bind(now()).fetch_optional(&state.0.db).await?.ok_or_else(unauthorized)?;
    let id: String = row.get("id");
    // A different tab may have changed the shared browser cookie to another account.
    if headers
        .get("x-callpath-user")
        .is_some_and(|expected| expected.to_str().ok() != Some(&id))
    {
        return Err(unauthorized());
    }
    Ok((id, row.get("username")))
}
async fn me(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    let (id, name) = current_user(&state, &headers).await?;
    Ok(Json(json!({"user":{"id":id,"username":name}})))
}
async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Result<Response, ApiError> {
    if cookie_token(&headers).is_some() {
        current_user(&state, &headers).await?;
    }
    if let Some(token) = cookie_token(&headers) {
        sqlx::query("DELETE FROM sessions WHERE token_hash=?")
            .bind(token_hash(token))
            .execute(&state.0.db)
            .await?;
    }
    Ok(clear_cookie(&state))
}
fn clear_cookie(state: &AppState) -> Response {
    let mut response = Json(json!({"ok":true})).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&session_cookie(state, "", 0)).unwrap(),
    );
    response
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PasswordChange {
    current_password: String,
    new_password: String,
}
async fn change_password(
    State(state): State<AppState>,
    peer: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<PasswordChange>,
) -> Result<Response, ApiError> {
    let (id, name) = current_user(&state, &headers).await?;
    throttle(&state, &headers, peer, &name)?;
    valid_password(&body.new_password)?;
    valid_password(&body.current_password)?;
    let hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id=?")
        .bind(&id)
        .fetch_one(&state.0.db)
        .await?;
    let verified = password_job(&state, move || {
        Ok(PasswordHash::new(&hash).is_ok_and(|hash| {
            Argon2::default()
                .verify_password(body.current_password.as_bytes(), &hash)
                .is_ok()
        }))
    })
    .await?;
    if !verified {
        return Err(bad("当前密码错误"));
    }
    reset_password(&state, &name, &body.new_password).await?;
    Ok(clear_cookie(&state))
}
async fn load_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let (id, _) = current_user(&state, &headers).await?;
    let row = sqlx::query("SELECT document,revision,updated_at FROM workspaces WHERE user_id=?")
        .bind(id)
        .fetch_one(&state.0.db)
        .await?;
    let workspace: Option<String> = row.get("document");
    let workspace = workspace
        .map(|raw| serde_json::from_str::<Value>(&raw))
        .transpose()
        .map_err(|_| {
            ApiError(
                StatusCode::INTERNAL_SERVER_ERROR,
                "服务器数据格式错误，请联系管理员".into(),
            )
        })?;
    Ok(Json(
        json!({"workspace":workspace,"revision":row.get::<i64,_>("revision"),"updatedAt":row.get::<i64,_>("updated_at")}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkspaceWrite {
    revision: i64,
    workspace: Value,
}
async fn save_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<WorkspaceWrite>,
) -> Result<Json<Value>, ApiError> {
    let (id, _) = current_user(&state, &headers).await?;
    if body.revision < 0 {
        return Err(bad("版本号无效"));
    }
    validation::workspace(&body.workspace).map_err(bad)?;
    let document = serde_json::to_string(&body.workspace).map_err(|_| bad("数据格式错误"))?;
    if document.len() > MAX_WORKSPACE {
        return Err(ApiError(
            StatusCode::PAYLOAD_TOO_LARGE,
            "工作空间超过 20 MiB，请先导出并精简项目".into(),
        ));
    }
    let updated = now();
    let result = sqlx::query("UPDATE workspaces SET document=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?")
        .bind(document).bind(updated).bind(&id).bind(body.revision).execute(&state.0.db).await?;
    if result.rows_affected() != 1 {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "其他设备已更新数据。请下载当前副本，再加载服务器版本".into(),
        ));
    }
    Ok(Json(
        json!({"revision":body.revision+1,"updatedAt":updated}),
    ))
}
