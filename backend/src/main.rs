use callpath_server::{Config, create_user, open_state, reset_password, router};
use std::{
    io::{self, BufRead},
    net::SocketAddr,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "callpath_server=info,tower_http=info".into()),
        )
        .init();
    let config = Config::from_env()?;
    let state = open_state(config.clone()).await?;
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let [command, username] = args.as_slice() {
        if command != "create-user" && command != "reset-password" {
            return Err("unknown command".into());
        }
        eprintln!(
            "Read password from stdin (8–128 characters); input is not masked by this command."
        );
        let password = io::stdin()
            .lock()
            .lines()
            .next()
            .ok_or("password required on stdin")??;
        if command == "create-user" {
            create_user(&state, username, &password).await?;
        } else {
            reset_password(&state, username, &password).await?;
        }
        eprintln!("Account updated.");
        return Ok(());
    }
    if !args.is_empty() {
        return Err("usage: callpath-server [create-user|reset-password USERNAME]".into());
    }
    let address: SocketAddr = config.bind.parse()?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(bind = %address, origin = %config.public_origin, "Callpath ready");
    axum::serve(
        listener,
        router(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown())
    .await?;
    Ok(())
}

async fn shutdown() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("register SIGTERM handler");
        tokio::select! { _=tokio::signal::ctrl_c()=>{}, _=terminate.recv()=>{} }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
