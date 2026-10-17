use axum::{routing::{get, post}, Router};
async fn create_invoice() -> String { String::new() }
async fn get_invoice() -> String { String::new() }
fn app() -> Router {
    Router::new().route("/api/invoices", post(create_invoice)).route("/api/invoices/:id", get(get_invoice))
}
