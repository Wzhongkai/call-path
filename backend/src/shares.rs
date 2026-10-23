use super::*;
use axum::extract::Path;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Publish {
    project_id: String,
    revision: i64,
}
fn missing() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "分享不存在或已撤销".into())
}
fn metadata(state: &AppState, row: &sqlx::sqlite::SqliteRow) -> Value {
    let token: String = row.get("token");
    json!({"token":token,"projectId":row.get::<String,_>("project_id"),
        "title":row.get::<String,_>("title"),"createdAt":row.get::<i64,_>("created_at"),
        "updatedAt":row.get::<i64,_>("updated_at"),
        "url":format!("{}{}/?share={token}",state.0.config.public_origin,state.0.config.base_path)})
}
pub(super) async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let (id, _) = current_user(&state, &headers).await?;
    let rows = sqlx::query("SELECT token,project_id,title,created_at,updated_at FROM project_shares WHERE user_id=? ORDER BY updated_at DESC")
        .bind(id).fetch_all(&state.0.db).await?;
    Ok(Json(
        json!({"shares":rows.iter().map(|row|metadata(&state,row)).collect::<Vec<_>>()}),
    ))
}
pub(super) async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Publish>,
) -> Result<Json<Value>, ApiError> {
    publish(state, headers, body, None).await
}
pub(super) async fn update(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Json(body): Json<Publish>,
) -> Result<Json<Value>, ApiError> {
    publish(state, headers, body, Some(token)).await
}
async fn publish(
    state: AppState,
    headers: HeaderMap,
    body: Publish,
    existing: Option<String>,
) -> Result<Json<Value>, ApiError> {
    let (id, _) = current_user(&state, &headers).await?;
    if body.revision < 0 || body.project_id.is_empty() || body.project_id.len() > 400 {
        return Err(bad("项目或版本号无效"));
    }
    if let Some(token) = &existing {
        let owned: Option<String> =
            sqlx::query_scalar("SELECT project_id FROM project_shares WHERE token=? AND user_id=?")
                .bind(token)
                .bind(&id)
                .fetch_optional(&state.0.db)
                .await?;
        if owned.as_deref() != Some(&body.project_id) {
            return Err(missing());
        }
    }
    let mut tx = state.0.db.begin().await?;
    // Acquire SQLite's write lock before reading; the snapshot and revision stay consistent.
    let locked =
        sqlx::query("UPDATE workspaces SET revision=revision WHERE user_id=? AND revision=?")
            .bind(&id)
            .bind(body.revision)
            .execute(&mut *tx)
            .await?;
    if locked.rows_affected() != 1 {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "项目已在其他设备更新，请先同步后重新分享".into(),
        ));
    }
    if let Some(token) = &existing {
        let owned: Option<String> =
            sqlx::query_scalar("SELECT project_id FROM project_shares WHERE token=? AND user_id=?")
                .bind(token)
                .bind(&id)
                .fetch_optional(&mut *tx)
                .await?;
        if owned.as_deref() != Some(&body.project_id) {
            return Err(missing());
        }
    }
    let raw: Option<String> = sqlx::query_scalar("SELECT document FROM workspaces WHERE user_id=?")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    let workspace: Value = serde_json::from_str(raw.as_deref().unwrap_or("null"))
        .map_err(|_| bad("项目数据无法读取"))?;
    let project = workspace["projects"]
        .as_array()
        .and_then(|items| items.iter().find(|p| p["id"] == body.project_id))
        .ok_or_else(|| bad("项目不存在，请先保存到服务器"))?;
    let snapshot =
        serde_json::to_string(&json!({"document":project["document"],"view":project["view"]}))
            .map_err(|_| bad("项目数据格式错误"))?;
    let title = project["document"]["title"]
        .as_str()
        .ok_or_else(|| bad("项目名称无效"))?;
    let token = existing.clone().unwrap_or_else(random_token);
    let total: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(length(CAST(snapshot AS BLOB))),0) FROM project_shares WHERE user_id=? AND token<>?")
        .bind(&id).bind(&token).fetch_one(&mut *tx).await?;
    if total + snapshot.len() as i64 > MAX_WORKSPACE as i64 {
        return Err(ApiError(
            StatusCode::PAYLOAD_TOO_LARGE,
            "分享内容合计超过 20 MiB，请撤销不再需要的分享".into(),
        ));
    }
    let updated = now();
    if existing.is_some() {
        sqlx::query(
            "UPDATE project_shares SET title=?,snapshot=?,updated_at=? WHERE token=? AND user_id=?",
        )
        .bind(title)
        .bind(snapshot)
        .bind(updated)
        .bind(&token)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    } else {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM project_shares WHERE user_id=?")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
        if count >= 100 {
            return Err(bad("最多保留 100 个项目分享，请先撤销旧分享"));
        }
        let duplicate: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM project_shares WHERE user_id=? AND project_id=?",
        )
        .bind(&id)
        .bind(&body.project_id)
        .fetch_one(&mut *tx)
        .await?;
        if duplicate > 0 {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "该项目已有分享，请使用更新分享".into(),
            ));
        }
        sqlx::query("INSERT INTO project_shares (token,user_id,project_id,title,snapshot,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
            .bind(&token).bind(&id).bind(&body.project_id).bind(title).bind(snapshot).bind(updated).bind(updated).execute(&mut *tx).await?;
    }
    let row = sqlx::query(
        "SELECT token,project_id,title,created_at,updated_at FROM project_shares WHERE token=?",
    )
    .bind(token)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"share":metadata(&state,&row)})))
}
pub(super) async fn revoke(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (id, _) = current_user(&state, &headers).await?;
    let result = sqlx::query("DELETE FROM project_shares WHERE token=? AND user_id=?")
        .bind(token)
        .bind(id)
        .execute(&state.0.db)
        .await?;
    if result.rows_affected() != 1 {
        return Err(missing());
    }
    Ok(Json(json!({"ok":true})))
}
pub(super) async fn read(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<Value>, ApiError> {
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(missing());
    }
    let row = sqlx::query("SELECT snapshot,updated_at FROM project_shares WHERE token=?")
        .bind(token)
        .fetch_optional(&state.0.db)
        .await?
        .ok_or_else(missing)?;
    let snapshot: Value = serde_json::from_str(&row.get::<String, _>("snapshot"))
        .map_err(|_| bad("分享数据无法读取"))?;
    Ok(Json(
        json!({"project":snapshot,"updatedAt":row.get::<i64,_>("updated_at")}),
    ))
}
