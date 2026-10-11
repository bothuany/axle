package web

import "github.com/gin-gonic/gin"

func (h *OrderHandler) List() { h.svc.All() }

func listOrders(h *OrderHandler) {
	h.List()
	cron.AddFunc("@daily", func() { cleanup() })
	cache.Get("k", &out)
}

func Register(r *gin.Engine, h *OrderHandler) {
	r.GET("/orders", listOrders)
}
