use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use callpath_server::{Config, create_user, open_state, router};
use serde_json::{Value, json};
use tempfile::TempDir;
use tower::ServiceExt;

fn config(temp: &TempDir) -> Config {
    Config {
        bind: "127.0.0.1:8080".into(),
        public_origin: "https://callpath.example".into(),
        database: temp.path().join("test.sqlite3"),
        static_dir: std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist"),
        registration: true,
        secure_cookie: true,
        base_path: String::new(),
    }
}
async fn request(
    app: &Router,
    method: &str,
    path: &str,
    cookie: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, axum::http::HeaderMap, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("x-callpath-request", "1")
        .header("origin", "https://callpath.example");
    if let Some(cookie) = cookie {
        req = req.header(header::COOKIE, cookie);
    }
    if body.is_some() {
        req = req.header(header::CONTENT_TYPE, "application/json");
    }
    let response = app
        .clone()
        .oneshot(
            req.body(
                body.map(|v| Body::from(v.to_string()))
                    .unwrap_or_else(Body::empty),
            )
            .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 25 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        headers,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn register(app: &Router, name: &str) -> (String, String) {
    let (status, headers, body) = request(
        app,
        "POST",
        "/api/auth/register",
        None,
        Some(json!({"username":name,"password":"test-passphrase-2026"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let cookie = headers[header::SET_COOKIE].to_str().unwrap();
    assert!(
        cookie.contains("HttpOnly") && cookie.contains("Secure") && cookie.contains("SameSite=Lax")
    );
    (
        cookie.split(';').next().unwrap().to_owned(),
        body["user"]["id"].as_str().unwrap().to_owned(),
    )
}
fn workspace() -> Value {
    serde_json::from_str(include_str!("fixtures/workspace.json")).unwrap()
}

#[tokio::test]
async fn project_shares_are_owned_read_only_snapshots_with_revocation() {
    let temp = TempDir::new().unwrap();
    let mut cfg = config(&temp);
    cfg.base_path = "/code".into();
    let app = router(open_state(cfg.clone()).await.unwrap());
    let (alice, _) = register(&app, "sharealice").await;
    let (bob, _) = register(&app, "sharebob").await;
    let mut source = workspace();
    let project = source["projects"][0]["id"].as_str().unwrap().to_owned();
    let mut private = source["projects"][0].clone();
    private["id"] = json!("private-project");
    private["document"]["title"] = json!("PRIVATE PROJECT SECRET");
    source["projects"].as_array_mut().unwrap().push(private);
    assert_eq!(
        request(
            &app,
            "PUT",
            "/api/workspace",
            Some(&alice),
            Some(json!({"revision":0,"workspace":source}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let publish = json!({"projectId":project,"revision":1});
    assert_eq!(
        request(&app, "POST", "/api/shares", None, Some(publish.clone()))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let (status, _, created) = request(
        &app,
        "POST",
        "/api/shares",
        Some(&alice),
        Some(publish.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{created}");
    let token = created["share"]["token"].as_str().unwrap();
    assert_eq!(token.len(), 64);
    assert_eq!(
        created["share"]["url"],
        format!("https://callpath.example/code/?share={token}")
    );
    let public = format!("/api/shared/{token}");
    let owned = format!("/api/shares/{token}");
    let (status, headers, shared) = request(&app, "GET", &public, None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[header::CACHE_CONTROL], "no-store");
    assert_eq!(headers["referrer-policy"], "no-referrer");
    assert_eq!(
        shared["project"]["document"],
        source["projects"][0]["document"]
    );
    assert!(shared["project"]["id"].is_null());
    assert!(!shared.to_string().contains("PRIVATE PROJECT SECRET"));
    assert_eq!(
        request(&app, "GET", "/api/shares", Some(&bob), None)
            .await
            .2["shares"],
        json!([])
    );
    for method in ["PUT", "DELETE"] {
        assert_eq!(
            request(
                &app,
                method,
                &owned,
                Some(&bob),
                if method == "PUT" {
                    Some(publish.clone())
                } else {
                    None
                }
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
    }
    assert_eq!(
        request(&app, "PUT", &owned, None, Some(publish.clone()))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(&app, "PUT", &public, None, Some(publish.clone()))
            .await
            .0,
        StatusCode::METHOD_NOT_ALLOWED
    );
    source["projects"][0]["document"]["title"] = json!("Updated project");
    assert_eq!(
        request(
            &app,
            "PUT",
            "/api/workspace",
            Some(&alice),
            Some(json!({"revision":1,"workspace":source}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(request(&app, "GET", &public, None, None).await.2, shared);
    assert_eq!(
        request(&app, "PUT", &owned, Some(&alice), Some(publish.clone()))
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/shares",
            Some(&alice),
            Some(json!({"projectId":project,"revision":2}))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        request(
            &app,
            "PUT",
            &owned,
            Some(&alice),
            Some(json!({"projectId":project,"revision":2}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&app, "GET", &public, None, None).await.2["project"]["document"]["title"],
        "Updated project"
    );
    let reopened = router(open_state(cfg).await.unwrap());
    assert_eq!(
        request(&reopened, "GET", &public, None, None).await.0,
        StatusCode::OK
    );
    assert_eq!(
        request(&app, "DELETE", &owned, Some(&alice), None).await.0,
        StatusCode::OK
    );
    assert_eq!(
        request(&app, "GET", &public, None, None).await.0,
        StatusCode::NOT_FOUND
    );
    let replacement = request(
        &app,
        "POST",
        "/api/shares",
        Some(&alice),
        Some(json!({"projectId":project,"revision":2})),
    )
    .await
    .2;
    assert_ne!(replacement["share"]["token"], token);
    assert_eq!(
        request(&app, "GET", "/api/shared/invalid", None, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn upgrading_a_v1_database_preserves_accounts_and_workspaces() {
    let temp = TempDir::new().unwrap();
    let cfg = config(&temp);
    let state = open_state(cfg.clone()).await.unwrap();
    let app = router(state);
    let (cookie, _) = register(&app, "migrateuser").await;
    let source = workspace();
    assert_eq!(
        request(
            &app,
            "PUT",
            "/api/workspace",
            Some(&cookie),
            Some(json!({"revision":0,"workspace":source}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let db = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new().filename(&cfg.database),
    )
    .await
    .unwrap();
    sqlx::raw_sql("DROP TABLE project_shares; PRAGMA user_version=1;")
        .execute(&db)
        .await
        .unwrap();
    let upgraded = router(open_state(cfg).await.unwrap());
    assert_eq!(
        request(&upgraded, "GET", "/api/workspace", Some(&cookie), None)
            .await
            .2["workspace"],
        source
    );
    assert_eq!(
        request(&upgraded, "GET", "/api/shares", Some(&cookie), None)
            .await
            .2["shares"],
        json!([])
    );
    let version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(version, 2);
}

#[tokio::test]
async fn users_are_isolated_and_workspace_survives_restart() {
    let temp = TempDir::new().unwrap();
    let cfg = config(&temp);
    let state = open_state(cfg.clone()).await.unwrap();
    let app = router(state);
    assert_eq!(
        request(&app, "GET", "/api/workspace", None, None).await.0,
        StatusCode::UNAUTHORIZED
    );
    let (alice, alice_id) = register(&app, "Alice").await;
    let (bob, bob_id) = register(&app, "bob").await;
    assert_ne!(alice_id, bob_id);
    let source = workspace();
    let (status, _, saved) = request(
        &app,
        "PUT",
        "/api/workspace",
        Some(&alice),
        Some(json!({"revision":0,"workspace":source})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["revision"], 1);
    let (_, _, bob_workspace) = request(
        &app,
        "GET",
        &format!("/api/workspace?user_id={alice_id}"),
        Some(&bob),
        None,
    )
    .await;
    assert!(bob_workspace["workspace"].is_null());
    assert_eq!(bob_workspace["revision"], 0);
    let state = open_state(cfg.clone()).await.unwrap();
    let reopened = router(state);
    let (status, headers, loaded) =
        request(&reopened, "GET", "/api/workspace", Some(&alice), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(loaded["workspace"], source);
    assert_eq!(headers[header::CACHE_CONTROL], "no-store");
    // Shared cookies may change when a second tab logs into another account.
    let req = Request::builder()
        .method("PUT")
        .uri("/api/workspace")
        .header("cookie", &bob)
        .header("x-callpath-user", &alice_id)
        .header("x-callpath-request", "1")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({"revision":0,"workspace":source}).to_string(),
        ))
        .unwrap();
    assert_eq!(
        reopened.oneshot(req).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
    let options = sqlx::sqlite::SqliteConnectOptions::new().filename(cfg.database);
    let db = sqlx::SqlitePool::connect_with(options).await.unwrap();
    let hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE username='alice'")
        .fetch_one(&db)
        .await
        .unwrap();
    assert!(hash.starts_with("$argon2id$"));
    let stored: Vec<String> = sqlx::query_scalar("SELECT token_hash FROM sessions")
        .fetch_all(&db)
        .await
        .unwrap();
    assert!(!stored.contains(&alice.split('=').nth(1).unwrap().to_string()));
}

#[tokio::test]
async fn stale_and_simultaneous_writes_never_overwrite_a_new_revision() {
    let temp = TempDir::new().unwrap();
    let app = router(open_state(config(&temp)).await.unwrap());
    let (cookie, _) = register(&app, "writer").await;
    let a = json!({"revision":0,"workspace":workspace()});
    let mut b = a.clone();
    b["workspace"]["projects"][0]["document"]["title"] = json!("另外一台设备");
    let (a, b) = tokio::join!(
        request(&app, "PUT", "/api/workspace", Some(&cookie), Some(a)),
        request(&app, "PUT", "/api/workspace", Some(&cookie), Some(b))
    );
    assert!(
        (a.0 == StatusCode::OK && b.0 == StatusCode::CONFLICT)
            || (a.0 == StatusCode::CONFLICT && b.0 == StatusCode::OK)
    );
    let current = request(&app, "GET", "/api/workspace", Some(&cookie), None)
        .await
        .2;
    assert_eq!(current["revision"], 1);
    assert_eq!(
        request(
            &app,
            "PUT",
            "/api/workspace",
            Some(&cookie),
            Some(json!({"revision":0,"workspace":workspace()}))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        request(&app, "GET", "/api/workspace", Some(&cookie), None)
            .await
            .2,
        current
    );
}

#[tokio::test]
async fn csrf_invalid_references_and_unknown_fields_are_rejected() {
    let temp = TempDir::new().unwrap();
    let app = router(open_state(config(&temp)).await.unwrap());
    let (cookie, _) = register(&app, "tester").await;
    for (origin, marker) in [
        ("https://evil.example", true),
        ("https://callpath.example", false),
    ] {
        let mut req = Request::builder()
            .method("POST")
            .uri("/api/auth/logout")
            .header("origin", origin)
            .header("cookie", &cookie);
        if marker {
            req = req.header("x-callpath-request", "1");
        }
        assert_eq!(
            app.clone()
                .oneshot(req.body(Body::empty()).unwrap())
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
    }
    let mut source = workspace();
    source["projects"][0]["document"]["edges"][0]["to"] = json!("missing-node");
    assert_eq!(
        request(
            &app,
            "PUT",
            "/api/workspace",
            Some(&cookie),
            Some(json!({"revision":0,"workspace":source}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &app,
            "PUT",
            "/api/workspace",
            Some(&cookie),
            Some(json!({"revision":0,"workspace":workspace(),"userId":"forged"}))
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        request(&app, "GET", "/api/not-a-route", None, None).await.0,
        StatusCode::NOT_FOUND
    );
    let response = app
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().contains_key("content-security-policy"));
}

#[tokio::test]
async fn login_logout_password_change_and_expiry_revoke_sessions() {
    let temp = TempDir::new().unwrap();
    let cfg = config(&temp);
    let app = router(open_state(cfg.clone()).await.unwrap());
    let (cookie, _) = register(&app, "member").await;
    let bad_login = json!({"username":"member","password":"wrong-password"});
    assert_eq!(
        request(&app, "POST", "/api/auth/login", None, Some(bad_login))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/auth/password",
            Some(&cookie),
            Some(
                json!({"current_password":"test-passphrase-2026","new_password":"a-new-passphrase"})
            )
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&app, "GET", "/api/auth/me", Some(&cookie), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/auth/login",
            None,
            Some(json!({"username":"member","password":"test-passphrase-2026"}))
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let (status, headers, _) = request(
        &app,
        "POST",
        "/api/auth/login",
        None,
        Some(json!({"username":"MEMBER","password":"a-new-passphrase"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let cookie = headers[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap();
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/auth/logout",
            Some(cookie),
            Some(json!({}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&app, "GET", "/api/auth/me", Some(cookie), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let (status, headers, _) = request(
        &app,
        "POST",
        "/api/auth/login",
        None,
        Some(json!({"username":"member","password":"a-new-passphrase"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let cookie = headers[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap();
    let db = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new().filename(cfg.database),
    )
    .await
    .unwrap();
    sqlx::query("UPDATE sessions SET expires_at=0")
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        request(&app, "GET", "/api/auth/me", Some(cookie), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn registration_can_be_closed_and_login_is_throttled() {
    let temp = TempDir::new().unwrap();
    let mut cfg = config(&temp);
    cfg.registration = false;
    let state = open_state(cfg).await.unwrap();
    create_user(&state, "managed", "test-passphrase-2026")
        .await
        .unwrap();
    let app = router(state);
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/auth/register",
            None,
            Some(json!({"username":"public","password":"test-passphrase-2026"}))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    for _ in 0..15 {
        assert_eq!(
            request(
                &app,
                "POST",
                "/api/auth/login",
                None,
                Some(json!({"username":"missing","password":"wrong-password"}))
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/auth/login",
            None,
            Some(json!({"username":"missing","password":"wrong-password"}))
        )
        .await
        .0,
        StatusCode::TOO_MANY_REQUESTS
    );
}

#[tokio::test]
async fn subpath_session_cookie_is_scoped_to_code_for_login_and_logout() {
    let temp = TempDir::new().unwrap();
    let mut cfg = config(&temp);
    cfg.base_path = "/code".into();
    let app = router(open_state(cfg).await.unwrap());
    let (status, headers, _) = request(
        &app,
        "POST",
        "/api/auth/register",
        None,
        Some(json!({"username":"scoped","password":"test-passphrase-2026"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let set_cookie = headers[header::SET_COOKIE].to_str().unwrap();
    assert!(set_cookie.contains("Path=/code/;"));
    assert!(set_cookie.contains("Secure"));
    let cookie = set_cookie.split(';').next().unwrap();
    let (status, headers, _) = request(
        &app,
        "POST",
        "/api/auth/logout",
        Some(cookie),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let cleared = headers[header::SET_COOKIE].to_str().unwrap();
    assert!(cleared.contains("Path=/code/;") && cleared.contains("Max-Age=0"));
}
