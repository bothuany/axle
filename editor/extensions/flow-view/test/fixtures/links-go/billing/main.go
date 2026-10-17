package main

import "github.com/gin-gonic/gin"

func createInvoice(c *gin.Context) { c.JSON(201, nil) }
func getInvoice(c *gin.Context)    { c.JSON(200, nil) }

func main() {
	r := gin.Default()
	api := r.Group("/api")
	api.POST("/invoices", createInvoice)
	api.GET("/invoices/:id", getInvoice)
}
