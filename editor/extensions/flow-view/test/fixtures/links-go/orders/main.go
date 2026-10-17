package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/go-resty/resty/v2"
)

var billingURL = "http://billing"

// A request with a content type reads like a route registration; it must stay a request.
func placeOrder(c *gin.Context) {
	http.Post(billingURL+"/api/invoices", "application/json", nil)
}

func showOrder(c *gin.Context) {
	client := resty.New()
	client.R().Get("/api/invoices/" + c.Param("id"))
}

// No route of this workspace answers it: no edge.
func ping(c *gin.Context) {
	http.Get("https://example.com/status")
}

func main() {
	r := gin.Default()
	r.POST("/orders", placeOrder)
	r.GET("/orders/:id", showOrder)
	r.GET("/ping", ping)
}
