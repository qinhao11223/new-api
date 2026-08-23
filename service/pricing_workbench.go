package service

import (
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

var pricingWorkbenchSaveMutex sync.Mutex

func SavePricingWorkbench(
	input billing_setting.PricingWorkbenchConfig,
) (billing_setting.PricingWorkbenchConfig, []billing_setting.PricingWorkbenchPreview, error) {
	pricingWorkbenchSaveMutex.Lock()
	defer pricingWorkbenchSaveMutex.Unlock()

	currentConfig := billing_setting.GetPricingWorkbench()
	if input.Revision != currentConfig.Revision {
		return billing_setting.PricingWorkbenchConfig{}, nil, fmt.Errorf(
			"pricing workbench was updated by another administrator; refresh before saving",
		)
	}

	config, compiled, previews, err := billing_setting.CompilePricingWorkbench(
		input,
		billing_setting.PricingWorkbenchMaps{
			ModelPrice:      ratio_setting.GetModelPriceCopy(),
			ModelRatio:      ratio_setting.GetModelRatioCopy(),
			CompletionRatio: ratio_setting.GetCompletionRatioCopy(),
			BillingMode:     billing_setting.GetBillingModeCopy(),
			BillingExpr:     billing_setting.GetBillingExprCopy(),
		},
		operation_setting.USDExchangeRate,
	)
	if err != nil {
		return billing_setting.PricingWorkbenchConfig{}, nil, err
	}
	config.Revision = currentConfig.Revision + 1
	config.UpdatedAt = time.Now().Unix()

	configJSON, err := marshalPricingWorkbenchOption(config)
	if err != nil {
		return billing_setting.PricingWorkbenchConfig{}, nil, err
	}
	modelPriceJSON, err := marshalPricingWorkbenchOption(compiled.ModelPrice)
	if err != nil {
		return billing_setting.PricingWorkbenchConfig{}, nil, err
	}
	modelRatioJSON, err := marshalPricingWorkbenchOption(compiled.ModelRatio)
	if err != nil {
		return billing_setting.PricingWorkbenchConfig{}, nil, err
	}
	completionRatioJSON, err := marshalPricingWorkbenchOption(compiled.CompletionRatio)
	if err != nil {
		return billing_setting.PricingWorkbenchConfig{}, nil, err
	}
	billingModeJSON, err := marshalPricingWorkbenchOption(compiled.BillingMode)
	if err != nil {
		return billing_setting.PricingWorkbenchConfig{}, nil, err
	}
	billingExprJSON, err := marshalPricingWorkbenchOption(compiled.BillingExpr)
	if err != nil {
		return billing_setting.PricingWorkbenchConfig{}, nil, err
	}

	err = model.UpdateOptionsBulk(map[string]string{
		billing_setting.PricingWorkbenchOptionKey: configJSON,
		"ModelPrice":                   modelPriceJSON,
		"ModelRatio":                   modelRatioJSON,
		"CompletionRatio":              completionRatioJSON,
		"billing_setting.billing_mode": billingModeJSON,
		"billing_setting.billing_expr": billingExprJSON,
	})
	if err != nil {
		return billing_setting.PricingWorkbenchConfig{}, nil, err
	}
	return config, previews, nil
}

func marshalPricingWorkbenchOption(value any) (string, error) {
	data, err := common.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("marshal pricing workbench option: %w", err)
	}
	return string(data), nil
}
