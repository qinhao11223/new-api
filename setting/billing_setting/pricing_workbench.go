package billing_setting

import (
	"fmt"
	"math"
	"strings"
	"unicode"
)

const (
	PricingWorkbenchField     = "pricing_workbench"
	PricingWorkbenchOptionKey = "billing_setting." + PricingWorkbenchField

	PricingModalityText  = "text"
	PricingModalityImage = "image"
	PricingModalityVideo = "video"

	PricingStrategyTextMultiplier = "text_multiplier"
	PricingStrategyFixedRequest   = "fixed_per_request"
	PricingStrategyVideoCostPlus  = "video_cost_plus_fee"

	pricingWorkbenchSchemaVersion  = 1
	maxPricingWorkbenchRows        = 1000
	maxPricingWorkbenchAmountCNY   = 1_000_000
	maxPricingWorkbenchMultiplier  = 100
	maxPricingWorkbenchModelLength = 191
	maxPricingWorkbenchLabelLength = 191
	maxPricingWorkbenchNotesLength = 500
)

type PricingWorkbenchConfig struct {
	SchemaVersion      int                   `json:"schema_version"`
	Revision           int64                 `json:"revision"`
	UpdatedAt          int64                 `json:"updated_at"`
	TextMarkup         float64               `json:"text_markup"`
	VideoServiceFeeCNY float64               `json:"video_service_fee_cny"`
	VideoMinimumMarkup float64               `json:"video_minimum_markup"`
	Rows               []PricingWorkbenchRow `json:"rows"`
}

type PricingWorkbenchRow struct {
	Model                 string   `json:"model"`
	Modality              string   `json:"modality"`
	Strategy              string   `json:"strategy"`
	SourceLabel           string   `json:"source_label,omitempty"`
	RouteGroup            string   `json:"route_group,omitempty"`
	UpstreamInputCostCNY  *float64 `json:"upstream_input_cost_cny,omitempty"`
	UpstreamOutputCostCNY *float64 `json:"upstream_output_cost_cny,omitempty"`
	UpstreamCostCNY       *float64 `json:"upstream_cost_cny,omitempty"`
	FixedPriceCNY         *float64 `json:"fixed_price_cny,omitempty"`
	Notes                 string   `json:"notes,omitempty"`
	Enabled               bool     `json:"enabled"`
}

type PricingWorkbenchMaps struct {
	ModelPrice      map[string]float64
	ModelRatio      map[string]float64
	CompletionRatio map[string]float64
	BillingMode     map[string]string
	BillingExpr     map[string]string
}

type PricingWorkbenchPreview struct {
	Model            string   `json:"model"`
	Modality         string   `json:"modality"`
	RetailInputCNY   *float64 `json:"retail_input_cny,omitempty"`
	RetailOutputCNY  *float64 `json:"retail_output_cny,omitempty"`
	RetailRequestCNY *float64 `json:"retail_request_cny,omitempty"`
	GrossMargin      *float64 `json:"gross_margin,omitempty"`
}

func DefaultPricingWorkbenchConfig() PricingWorkbenchConfig {
	return PricingWorkbenchConfig{
		SchemaVersion:      pricingWorkbenchSchemaVersion,
		TextMarkup:         2,
		VideoServiceFeeCNY: 0.5,
		VideoMinimumMarkup: 1.2,
		Rows:               make([]PricingWorkbenchRow, 0),
	}
}

func NormalizePricingWorkbenchConfig(input PricingWorkbenchConfig) (PricingWorkbenchConfig, error) {
	config := input
	if config.SchemaVersion == 0 {
		config.SchemaVersion = pricingWorkbenchSchemaVersion
	}
	if config.SchemaVersion != pricingWorkbenchSchemaVersion {
		return PricingWorkbenchConfig{}, fmt.Errorf("unsupported pricing workbench schema version: %d", config.SchemaVersion)
	}
	if err := validatePricingMultiplier("text_markup", config.TextMarkup); err != nil {
		return PricingWorkbenchConfig{}, err
	}
	if err := validatePricingMoney("video_service_fee_cny", config.VideoServiceFeeCNY); err != nil {
		return PricingWorkbenchConfig{}, err
	}
	if err := validatePricingMultiplier("video_minimum_markup", config.VideoMinimumMarkup); err != nil {
		return PricingWorkbenchConfig{}, err
	}
	if len(config.Rows) > maxPricingWorkbenchRows {
		return PricingWorkbenchConfig{}, fmt.Errorf("pricing workbench cannot contain more than %d rows", maxPricingWorkbenchRows)
	}

	seenModels := make(map[string]struct{}, len(config.Rows))
	rows := make([]PricingWorkbenchRow, 0, len(config.Rows))
	for index, rawRow := range config.Rows {
		row := rawRow
		row.Model = strings.TrimSpace(row.Model)
		row.Modality = strings.TrimSpace(row.Modality)
		row.Strategy = strings.TrimSpace(row.Strategy)
		row.SourceLabel = strings.TrimSpace(row.SourceLabel)
		row.RouteGroup = strings.TrimSpace(row.RouteGroup)
		row.Notes = strings.TrimSpace(row.Notes)

		if row.Model == "" {
			return PricingWorkbenchConfig{}, fmt.Errorf("pricing workbench row %d requires a model", index+1)
		}
		if len(row.Model) > maxPricingWorkbenchModelLength || strings.IndexFunc(row.Model, unicode.IsControl) >= 0 {
			return PricingWorkbenchConfig{}, fmt.Errorf("pricing workbench model %q is too long or contains control characters", row.Model)
		}
		if _, exists := seenModels[row.Model]; exists {
			return PricingWorkbenchConfig{}, fmt.Errorf("pricing workbench model %q is duplicated", row.Model)
		}
		seenModels[row.Model] = struct{}{}

		if len(row.SourceLabel) > maxPricingWorkbenchLabelLength || strings.IndexFunc(row.SourceLabel, unicode.IsControl) >= 0 {
			return PricingWorkbenchConfig{}, fmt.Errorf("pricing workbench source label for %q is invalid", row.Model)
		}
		if len(row.RouteGroup) > maxPricingWorkbenchLabelLength || strings.IndexFunc(row.RouteGroup, unicode.IsControl) >= 0 {
			return PricingWorkbenchConfig{}, fmt.Errorf("pricing workbench route group for %q is invalid", row.Model)
		}
		if len(row.Notes) > maxPricingWorkbenchNotesLength || strings.IndexFunc(row.Notes, unicode.IsControl) >= 0 {
			return PricingWorkbenchConfig{}, fmt.Errorf("pricing workbench notes for %q are invalid", row.Model)
		}
		if err := validateOptionalPricingMoney("upstream_input_cost_cny", row.Model, row.UpstreamInputCostCNY); err != nil {
			return PricingWorkbenchConfig{}, err
		}
		if err := validateOptionalPricingMoney("upstream_output_cost_cny", row.Model, row.UpstreamOutputCostCNY); err != nil {
			return PricingWorkbenchConfig{}, err
		}
		if err := validateOptionalPricingMoney("upstream_cost_cny", row.Model, row.UpstreamCostCNY); err != nil {
			return PricingWorkbenchConfig{}, err
		}
		if err := validateOptionalPricingMoney("fixed_price_cny", row.Model, row.FixedPriceCNY); err != nil {
			return PricingWorkbenchConfig{}, err
		}
		if err := validatePricingWorkbenchRow(row); err != nil {
			return PricingWorkbenchConfig{}, err
		}
		rows = append(rows, row)
	}
	config.Rows = rows
	return config, nil
}

func CompilePricingWorkbench(
	input PricingWorkbenchConfig,
	current PricingWorkbenchMaps,
	usdExchangeRate float64,
) (PricingWorkbenchConfig, PricingWorkbenchMaps, []PricingWorkbenchPreview, error) {
	config, err := NormalizePricingWorkbenchConfig(input)
	if err != nil {
		return PricingWorkbenchConfig{}, PricingWorkbenchMaps{}, nil, err
	}
	if usdExchangeRate <= 0 || math.IsNaN(usdExchangeRate) || math.IsInf(usdExchangeRate, 0) {
		return PricingWorkbenchConfig{}, PricingWorkbenchMaps{}, nil, fmt.Errorf("USD exchange rate must be a finite number greater than zero")
	}

	compiled := PricingWorkbenchMaps{
		ModelPrice:      copyFloatMap(current.ModelPrice),
		ModelRatio:      copyFloatMap(current.ModelRatio),
		CompletionRatio: copyFloatMap(current.CompletionRatio),
		BillingMode:     copyStringMap(current.BillingMode),
		BillingExpr:     copyStringMap(current.BillingExpr),
	}
	previews := make([]PricingWorkbenchPreview, 0, len(config.Rows))
	for _, row := range config.Rows {
		preview := buildPricingWorkbenchPreview(config, row)
		if err := validateOptionalPricingMoney("retail_input_cny", row.Model, preview.RetailInputCNY); err != nil {
			return PricingWorkbenchConfig{}, PricingWorkbenchMaps{}, nil, err
		}
		if err := validateOptionalPricingMoney("retail_output_cny", row.Model, preview.RetailOutputCNY); err != nil {
			return PricingWorkbenchConfig{}, PricingWorkbenchMaps{}, nil, err
		}
		if err := validateOptionalPricingMoney("retail_request_cny", row.Model, preview.RetailRequestCNY); err != nil {
			return PricingWorkbenchConfig{}, PricingWorkbenchMaps{}, nil, err
		}
		previews = append(previews, preview)
		if !row.Enabled {
			continue
		}

		delete(compiled.BillingMode, row.Model)
		delete(compiled.BillingExpr, row.Model)
		if row.Modality == PricingModalityText {
			retailInputUSD := *preview.RetailInputCNY / usdExchangeRate
			retailOutputUSD := *preview.RetailOutputCNY / usdExchangeRate
			compiled.ModelRatio[row.Model] = retailInputUSD / 2
			compiled.CompletionRatio[row.Model] = retailOutputUSD / retailInputUSD
			delete(compiled.ModelPrice, row.Model)
			continue
		}

		compiled.ModelPrice[row.Model] = *preview.RetailRequestCNY / usdExchangeRate
		delete(compiled.ModelRatio, row.Model)
		delete(compiled.CompletionRatio, row.Model)
	}
	return config, compiled, previews, nil
}

func validatePricingWorkbenchRow(row PricingWorkbenchRow) error {
	switch row.Modality {
	case PricingModalityText:
		if row.Strategy != PricingStrategyTextMultiplier {
			return fmt.Errorf("text model %q must use text_multiplier pricing", row.Model)
		}
		if !row.Enabled {
			return nil
		}
		if row.UpstreamInputCostCNY == nil || *row.UpstreamInputCostCNY <= 0 {
			return fmt.Errorf("text model %q requires an upstream input cost greater than zero", row.Model)
		}
		if row.UpstreamOutputCostCNY == nil {
			return fmt.Errorf("text model %q requires an upstream output cost", row.Model)
		}
	case PricingModalityImage:
		if row.Strategy != PricingStrategyFixedRequest {
			return fmt.Errorf("image model %q must use fixed_per_request pricing", row.Model)
		}
		if row.Enabled && row.FixedPriceCNY == nil {
			return fmt.Errorf("image model %q requires a fixed request price", row.Model)
		}
	case PricingModalityVideo:
		if row.Strategy != PricingStrategyVideoCostPlus && row.Strategy != PricingStrategyFixedRequest {
			return fmt.Errorf("video model %q uses an unsupported pricing strategy", row.Model)
		}
		if !row.Enabled {
			return nil
		}
		if row.Strategy == PricingStrategyVideoCostPlus && row.UpstreamCostCNY == nil {
			return fmt.Errorf("video model %q requires an upstream request cost", row.Model)
		}
		if row.Strategy == PricingStrategyFixedRequest && row.FixedPriceCNY == nil {
			return fmt.Errorf("video model %q requires a fixed request price", row.Model)
		}
	default:
		return fmt.Errorf("model %q uses unsupported modality %q", row.Model, row.Modality)
	}
	return nil
}

func buildPricingWorkbenchPreview(config PricingWorkbenchConfig, row PricingWorkbenchRow) PricingWorkbenchPreview {
	preview := PricingWorkbenchPreview{Model: row.Model, Modality: row.Modality}
	if !row.Enabled {
		return preview
	}

	switch row.Modality {
	case PricingModalityText:
		retailInput := *row.UpstreamInputCostCNY * config.TextMarkup
		retailOutput := *row.UpstreamOutputCostCNY * config.TextMarkup
		margin := 1 - 1/config.TextMarkup
		preview.RetailInputCNY = &retailInput
		preview.RetailOutputCNY = &retailOutput
		preview.GrossMargin = &margin
	case PricingModalityImage:
		retail := *row.FixedPriceCNY
		preview.RetailRequestCNY = &retail
		preview.GrossMargin = grossMargin(row.UpstreamCostCNY, retail)
	case PricingModalityVideo:
		retail := 0.0
		if row.Strategy == PricingStrategyFixedRequest {
			retail = *row.FixedPriceCNY
		} else {
			retail = math.Max(
				*row.UpstreamCostCNY+config.VideoServiceFeeCNY,
				*row.UpstreamCostCNY*config.VideoMinimumMarkup,
			)
		}
		preview.RetailRequestCNY = &retail
		preview.GrossMargin = grossMargin(row.UpstreamCostCNY, retail)
	}
	return preview
}

func grossMargin(cost *float64, retail float64) *float64 {
	if cost == nil || retail <= 0 {
		return nil
	}
	margin := (retail - *cost) / retail
	return &margin
}

func validatePricingMultiplier(field string, value float64) error {
	if value < 1 || value > maxPricingWorkbenchMultiplier || math.IsNaN(value) || math.IsInf(value, 0) {
		return fmt.Errorf("%s must be a finite number between 1 and %d", field, maxPricingWorkbenchMultiplier)
	}
	return nil
}

func validatePricingMoney(field string, value float64) error {
	if value < 0 || value > maxPricingWorkbenchAmountCNY || math.IsNaN(value) || math.IsInf(value, 0) {
		return fmt.Errorf("%s must be a finite number between 0 and %d", field, maxPricingWorkbenchAmountCNY)
	}
	return nil
}

func validateOptionalPricingMoney(field, model string, value *float64) error {
	if value == nil {
		return nil
	}
	if err := validatePricingMoney(field, *value); err != nil {
		return fmt.Errorf("model %q: %w", model, err)
	}
	return nil
}

func copyFloatMap(source map[string]float64) map[string]float64 {
	copy := make(map[string]float64, len(source))
	for key, value := range source {
		copy[key] = value
	}
	return copy
}

func copyStringMap(source map[string]string) map[string]string {
	copy := make(map[string]string, len(source))
	for key, value := range source {
		copy[key] = value
	}
	return copy
}
