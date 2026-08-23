package billing_setting

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func pricingMoney(value float64) *float64 {
	return &value
}

func TestCompilePricingWorkbenchAppliesSupportedStrategies(t *testing.T) {
	config := DefaultPricingWorkbenchConfig()
	config.Rows = []PricingWorkbenchRow{
		{
			Model:                 "text-model",
			Modality:              PricingModalityText,
			Strategy:              PricingStrategyTextMultiplier,
			UpstreamInputCostCNY:  pricingMoney(7.3),
			UpstreamOutputCostCNY: pricingMoney(14.6),
			Enabled:               true,
		},
		{
			Model:           "image-model",
			Modality:        PricingModalityImage,
			Strategy:        PricingStrategyFixedRequest,
			UpstreamCostCNY: pricingMoney(0.8),
			FixedPriceCNY:   pricingMoney(1.2),
			Enabled:         true,
		},
		{
			Model:           "video-model-low-cost",
			Modality:        PricingModalityVideo,
			Strategy:        PricingStrategyVideoCostPlus,
			UpstreamCostCNY: pricingMoney(1),
			Enabled:         true,
		},
		{
			Model:           "video-model-high-cost",
			Modality:        PricingModalityVideo,
			Strategy:        PricingStrategyVideoCostPlus,
			UpstreamCostCNY: pricingMoney(10),
			Enabled:         true,
		},
	}
	current := PricingWorkbenchMaps{
		ModelPrice: map[string]float64{
			"text-model": 99,
			"unmanaged":  3,
		},
		ModelRatio: map[string]float64{
			"image-model": 99,
		},
		CompletionRatio: map[string]float64{
			"image-model": 99,
		},
		BillingMode: map[string]string{
			"text-model": "tiered",
		},
		BillingExpr: map[string]string{
			"text-model": "input_tokens",
		},
	}

	normalized, compiled, previews, err := CompilePricingWorkbench(config, current, 7.3)
	require.NoError(t, err)
	require.Len(t, previews, 4)
	assert.Equal(t, config.TextMarkup, normalized.TextMarkup)

	assert.InDelta(t, 1, compiled.ModelRatio["text-model"], 0.000001)
	assert.InDelta(t, 2, compiled.CompletionRatio["text-model"], 0.000001)
	_, hasTextFixedPrice := compiled.ModelPrice["text-model"]
	assert.False(t, hasTextFixedPrice)
	_, hasTextMode := compiled.BillingMode["text-model"]
	assert.False(t, hasTextMode)
	_, hasTextExpr := compiled.BillingExpr["text-model"]
	assert.False(t, hasTextExpr)

	assert.InDelta(t, 1.2/7.3, compiled.ModelPrice["image-model"], 0.000001)
	_, hasImageRatio := compiled.ModelRatio["image-model"]
	assert.False(t, hasImageRatio)
	_, hasImageCompletionRatio := compiled.CompletionRatio["image-model"]
	assert.False(t, hasImageCompletionRatio)

	assert.InDelta(t, 1.5/7.3, compiled.ModelPrice["video-model-low-cost"], 0.000001)
	assert.InDelta(t, 12/7.3, compiled.ModelPrice["video-model-high-cost"], 0.000001)
	assert.Equal(t, 3.0, compiled.ModelPrice["unmanaged"])

	require.NotNil(t, previews[0].RetailInputCNY)
	require.NotNil(t, previews[0].RetailOutputCNY)
	assert.InDelta(t, 14.6, *previews[0].RetailInputCNY, 0.000001)
	assert.InDelta(t, 29.2, *previews[0].RetailOutputCNY, 0.000001)
	require.NotNil(t, previews[2].RetailRequestCNY)
	assert.InDelta(t, 1.5, *previews[2].RetailRequestCNY, 0.000001)
}

func TestNormalizePricingWorkbenchRejectsUnsafeOrAmbiguousRows(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*PricingWorkbenchConfig)
	}{
		{
			name: "duplicate model",
			mutate: func(config *PricingWorkbenchConfig) {
				config.Rows = []PricingWorkbenchRow{
					{Model: "same", Modality: PricingModalityImage, Strategy: PricingStrategyFixedRequest, Enabled: false},
					{Model: "same", Modality: PricingModalityImage, Strategy: PricingStrategyFixedRequest, Enabled: false},
				}
			},
		},
		{
			name: "non finite multiplier",
			mutate: func(config *PricingWorkbenchConfig) {
				config.TextMarkup = math.Inf(1)
			},
		},
		{
			name: "unsupported strategy",
			mutate: func(config *PricingWorkbenchConfig) {
				config.Rows = []PricingWorkbenchRow{{
					Model: "text", Modality: PricingModalityText, Strategy: PricingStrategyFixedRequest, Enabled: false,
				}}
			},
		},
		{
			name: "missing required text cost",
			mutate: func(config *PricingWorkbenchConfig) {
				config.Rows = []PricingWorkbenchRow{{
					Model: "text", Modality: PricingModalityText, Strategy: PricingStrategyTextMultiplier, Enabled: true,
				}}
			},
		},
		{
			name: "excessive video cost",
			mutate: func(config *PricingWorkbenchConfig) {
				config.Rows = []PricingWorkbenchRow{{
					Model: "video", Modality: PricingModalityVideo, Strategy: PricingStrategyVideoCostPlus,
					UpstreamCostCNY: pricingMoney(maxPricingWorkbenchAmountCNY + 1), Enabled: true,
				}}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := DefaultPricingWorkbenchConfig()
			tt.mutate(&config)

			_, err := NormalizePricingWorkbenchConfig(config)
			require.Error(t, err)
		})
	}
}

func TestCompilePricingWorkbenchLeavesDisabledRowsUntouched(t *testing.T) {
	config := DefaultPricingWorkbenchConfig()
	config.Rows = []PricingWorkbenchRow{{
		Model:    "disabled-model",
		Modality: PricingModalityText,
		Strategy: PricingStrategyTextMultiplier,
		Enabled:  false,
	}}
	current := PricingWorkbenchMaps{
		ModelPrice:      map[string]float64{"disabled-model": 4},
		ModelRatio:      map[string]float64{"disabled-model": 5},
		CompletionRatio: map[string]float64{"disabled-model": 6},
		BillingMode:     map[string]string{"disabled-model": "tiered"},
		BillingExpr:     map[string]string{"disabled-model": "input_tokens"},
	}

	_, compiled, previews, err := CompilePricingWorkbench(config, current, 7.3)
	require.NoError(t, err)
	require.Len(t, previews, 1)
	assert.Nil(t, previews[0].RetailInputCNY)
	assert.Equal(t, current.ModelPrice, compiled.ModelPrice)
	assert.Equal(t, current.ModelRatio, compiled.ModelRatio)
	assert.Equal(t, current.CompletionRatio, compiled.CompletionRatio)
	assert.Equal(t, current.BillingMode, compiled.BillingMode)
	assert.Equal(t, current.BillingExpr, compiled.BillingExpr)
}

func TestCompilePricingWorkbenchRejectsExcessiveComputedRetailPrice(t *testing.T) {
	config := DefaultPricingWorkbenchConfig()
	config.TextMarkup = 2
	config.Rows = []PricingWorkbenchRow{{
		Model:                 "expensive-text-model",
		Modality:              PricingModalityText,
		Strategy:              PricingStrategyTextMultiplier,
		UpstreamInputCostCNY:  pricingMoney(maxPricingWorkbenchAmountCNY),
		UpstreamOutputCostCNY: pricingMoney(1),
		Enabled:               true,
	}}

	_, _, _, err := CompilePricingWorkbench(config, PricingWorkbenchMaps{}, 7.3)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "retail_input_cny")
}
