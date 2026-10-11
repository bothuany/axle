pub struct Address {
    pub street: String,
}

pub struct Customer {
    pub name: String,
    pub address: Option<Address>,
    pub history: Vec<Address>,
}

pub enum Tier {
    Gold,
    Silver,
}
