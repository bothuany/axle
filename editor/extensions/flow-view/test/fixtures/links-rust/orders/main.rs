use axum::{routing::{get, post}, Router};
async fn place_order(client: reqwest::Client) -> String {
    let _ = client.post(format!("{}/api/invoices", BILLING)).send().await;
    String::new()
}
async fn show_order(client: reqwest::Client) -> String {
    let _ = client.get("/api/invoices/7").send().await;
    String::new()
}
fn app() -> Router {
    Router::new().route("/orders", post(place_order)).route("/orders/:id", get(show_order))
}
