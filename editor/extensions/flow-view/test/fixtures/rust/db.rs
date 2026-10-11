pub fn all() -> String { audit() }
pub fn audit() -> String { String::new() }
fn helper() -> String { audit() }
async fn create_user() -> String { db::all() }
