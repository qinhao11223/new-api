package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/gin-gonic/gin"
)

func UpdatePricingWorkbench(c *gin.Context) {
	var request billing_setting.PricingWorkbenchConfig
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorMsg(c, "invalid pricing workbench configuration")
		return
	}

	config, previews, err := service.SavePricingWorkbench(request)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "pricing_workbench.update", map[string]interface{}{
		"revision":    config.Revision,
		"model_count": len(config.Rows),
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"config":   config,
			"previews": previews,
		},
	})
}
