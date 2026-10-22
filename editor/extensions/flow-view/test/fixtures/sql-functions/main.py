from fastapi import FastAPI

app = FastAPI()


# FROM inside EXTRACT and TRIM names a column, not a table: the table is orders.
@app.get("/yearly")
def yearly(db):
    return db.execute("SELECT EXTRACT(YEAR FROM created_at) AS y, TRIM(BOTH ' ' FROM name) FROM orders")


# FOR UPDATE SKIP LOCKED locks rows of jobs; SKIP is not a table.
@app.post("/claim")
def claim(db):
    return db.execute("SELECT id FROM jobs FOR UPDATE SKIP LOCKED")


# ON DUPLICATE KEY UPDATE sets a column of carts.
@app.put("/carts")
def upsert(db):
    return db.execute("INSERT INTO carts (id, total) VALUES (1, 2) ON DUPLICATE KEY UPDATE total = 2")


# A subquery in parentheses still names its table.
@app.get("/buyers")
def buyers(db):
    return db.execute("SELECT id FROM users WHERE EXISTS (SELECT 1 FROM orders WHERE orders.user_id = users.id)")
