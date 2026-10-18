package main

import (
	"database/sql"
	"net/http"
)

var db *sql.DB

func listOrders(w http.ResponseWriter, r *http.Request) {
	rows, _ := db.Query("select id, status from orders")
	defer rows.Close()
}

func createOrder(w http.ResponseWriter, r *http.Request) {
	db.Exec("insert into orders (status) values ('open')")
}

func main() {
	http.HandleFunc("/orders", listOrders)
	http.HandleFunc("/orders/new", createOrder)
	http.ListenAndServe(":8080", nil)
}
