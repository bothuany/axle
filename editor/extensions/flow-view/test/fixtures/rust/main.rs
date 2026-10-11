use axum::{routing::{get, post}, Router};
#[get("/actix")]
async fn actix_handler() -> String { helper() }
async fn list_users() -> String { db::all() }
fn app() -> Router {
    Router::new().route("/users", get(list_users).post(create_user)).route("/h", get(|| async { "x" }))
}
impl UserRepo { fn all(&self) -> Vec<u8> { self.pool.query() } }
