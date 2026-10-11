package main

import "github.com/gin-gonic/gin"

type UserHandler struct{ svc *UserService }

func (h *UserHandler) List(c *gin.Context) {
	users := h.svc.FindAll()
	c.JSON(200, users)
}

func health(c *gin.Context) { c.String(200, "ok") }

func main() {
	r := gin.Default()
	api := r.Group("/api")
	h := &UserHandler{}
	api.GET("/users", h.List)
	r.GET("/health", health)
	r.POST("/ping", func(c *gin.Context) { notify() })
	http.HandleFunc("/legacy", legacy)
}
