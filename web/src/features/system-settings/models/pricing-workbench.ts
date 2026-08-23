/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

const IMAGE_MODEL_PATTERN =
  /(^|[-_.])(image|images|imagen|flux|dall-e|stable-diffusion|banana)([-_.]|$)/i
const VIDEO_MODEL_PATTERN =
  /(^|[-_.])(video|veo|sora|kling|seedance|runway|wan|hailuo)([-_.]|$)/i

export type PricingWorkbenchModality = 'text' | 'image' | 'video'
export type PricingWorkbenchStrategy =
  | 'text_multiplier'
  | 'fixed_per_request'
  | 'video_cost_plus_fee'

export type PricingWorkbenchRow = {
  model: string
  modality: PricingWorkbenchModality
  strategy: PricingWorkbenchStrategy
  source_label: string
  route_group: string
  upstream_input_cost_cny: number | null
  upstream_output_cost_cny: number | null
  upstream_cost_cny: number | null
  fixed_price_cny: number | null
  notes: string
  enabled: boolean
}

export type PricingWorkbenchImportCandidate = {
  model: string
  sourceLabel: string
  routeGroup: string
}

export type PricingWorkbenchImportBatch = {
  id: string
  candidates: PricingWorkbenchImportCandidate[]
}

export type PricingWorkbenchConfig = {
  schema_version: 1
  revision: number
  updated_at: number
  text_markup: number
  video_service_fee_cny: number
  video_minimum_markup: number
  rows: PricingWorkbenchRow[]
}

export type PricingWorkbenchPreview = {
  model: string
  modality: PricingWorkbenchModality
  retail_input_cny?: number
  retail_output_cny?: number
  retail_request_cny?: number
  gross_margin?: number
}

export type PricingWorkbenchModelMaps = {
  modelPrice: Record<string, number>
  modelRatio: Record<string, number>
  completionRatio: Record<string, number>
  billingMode?: Record<string, string>
  billingExpr?: Record<string, string>
}

export type PricingWorkbenchSaveResponse = {
  success: boolean
  message: string
  data?: {
    config: PricingWorkbenchConfig
    previews: PricingWorkbenchPreview[]
  }
}

export const DEFAULT_PRICING_WORKBENCH_CONFIG: PricingWorkbenchConfig = {
  schema_version: 1,
  revision: 0,
  updated_at: 0,
  text_markup: 2,
  video_service_fee_cny: 0.5,
  video_minimum_markup: 1.2,
  rows: [],
}

export const DEFAULT_PRICING_WORKBENCH_JSON = JSON.stringify(
  DEFAULT_PRICING_WORKBENCH_CONFIG
)

export function parsePricingWorkbenchConfig(
  raw: string | undefined
): PricingWorkbenchConfig {
  if (!raw) return structuredClone(DEFAULT_PRICING_WORKBENCH_CONFIG)

  try {
    const parsed = JSON.parse(raw) as Partial<PricingWorkbenchConfig>
    if (parsed.schema_version !== 1 || !Array.isArray(parsed.rows)) {
      return structuredClone(DEFAULT_PRICING_WORKBENCH_CONFIG)
    }
    const rows = parsed.rows.map((value) => {
      const row = value as Partial<PricingWorkbenchRow>
      const model = typeof row.model === 'string' ? row.model : ''
      const modality =
        row.modality === 'text' ||
        row.modality === 'image' ||
        row.modality === 'video'
          ? row.modality
          : classifyPricingModality(model)
      const fallbackStrategy = strategyForModality(modality)
      const strategy =
        row.strategy === 'text_multiplier' ||
        row.strategy === 'fixed_per_request' ||
        row.strategy === 'video_cost_plus_fee'
          ? row.strategy
          : fallbackStrategy

      return {
        model,
        modality,
        strategy,
        source_label:
          typeof row.source_label === 'string' ? row.source_label : '',
        route_group: typeof row.route_group === 'string' ? row.route_group : '',
        upstream_input_cost_cny:
          typeof row.upstream_input_cost_cny === 'number'
            ? row.upstream_input_cost_cny
            : null,
        upstream_output_cost_cny:
          typeof row.upstream_output_cost_cny === 'number'
            ? row.upstream_output_cost_cny
            : null,
        upstream_cost_cny:
          typeof row.upstream_cost_cny === 'number'
            ? row.upstream_cost_cny
            : null,
        fixed_price_cny:
          typeof row.fixed_price_cny === 'number' ? row.fixed_price_cny : null,
        notes: typeof row.notes === 'string' ? row.notes : '',
        enabled: row.enabled === true,
      }
    })
    return {
      schema_version: 1,
      revision:
        typeof parsed.revision === 'number' && parsed.revision >= 0
          ? parsed.revision
          : 0,
      updated_at:
        typeof parsed.updated_at === 'number' && parsed.updated_at >= 0
          ? parsed.updated_at
          : 0,
      text_markup:
        typeof parsed.text_markup === 'number' && parsed.text_markup >= 1
          ? parsed.text_markup
          : DEFAULT_PRICING_WORKBENCH_CONFIG.text_markup,
      video_service_fee_cny:
        typeof parsed.video_service_fee_cny === 'number' &&
        parsed.video_service_fee_cny >= 0
          ? parsed.video_service_fee_cny
          : DEFAULT_PRICING_WORKBENCH_CONFIG.video_service_fee_cny,
      video_minimum_markup:
        typeof parsed.video_minimum_markup === 'number' &&
        parsed.video_minimum_markup >= 1
          ? parsed.video_minimum_markup
          : DEFAULT_PRICING_WORKBENCH_CONFIG.video_minimum_markup,
      rows,
    }
  } catch {
    return structuredClone(DEFAULT_PRICING_WORKBENCH_CONFIG)
  }
}

export function parsePricingMap(raw: string): Record<string, number> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' && Number.isFinite(entry[1])
      )
    )
  } catch {
    return {}
  }
}

export function parsePricingStringMap(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    )
  } catch {
    return {}
  }
}

export function classifyPricingModality(
  model: string
): PricingWorkbenchModality {
  if (VIDEO_MODEL_PATTERN.test(model)) return 'video'
  if (IMAGE_MODEL_PATTERN.test(model)) return 'image'
  return 'text'
}

export function strategyForModality(
  modality: PricingWorkbenchModality
): PricingWorkbenchStrategy {
  if (modality === 'text') return 'text_multiplier'
  if (modality === 'image') return 'fixed_per_request'
  return 'video_cost_plus_fee'
}

export function createPricingWorkbenchRow(
  model: string,
  maps: PricingWorkbenchModelMaps,
  usdExchangeRate: number,
  textMarkup: number
): PricingWorkbenchRow {
  const modality = classifyPricingModality(model)
  const fixedPriceUSD = maps.modelPrice[model]
  const inputRatio = maps.modelRatio[model]
  const completionRatio = maps.completionRatio[model] ?? 1
  const hasFixedPrice = Number.isFinite(fixedPriceUSD)
  const hasTokenPrice = Number.isFinite(inputRatio)
  const hasTieredPricing =
    maps.billingMode?.[model] === 'tiered_expr' ||
    Boolean(maps.billingExpr?.[model])
  const safeExchangeRate = usdExchangeRate > 0 ? usdExchangeRate : 1
  const safeTextMarkup = textMarkup >= 1 ? textMarkup : 2

  if (hasTieredPricing) {
    return {
      model,
      modality,
      strategy: strategyForModality(modality),
      source_label: '',
      route_group: 'default',
      upstream_input_cost_cny: null,
      upstream_output_cost_cny: null,
      upstream_cost_cny: null,
      fixed_price_cny: null,
      notes: '',
      enabled: false,
    }
  }

  if (modality === 'text') {
    const retailInputCNY = hasTokenPrice
      ? inputRatio * 2 * safeExchangeRate
      : null
    return {
      model,
      modality,
      strategy: 'text_multiplier',
      source_label: '',
      route_group: 'default',
      upstream_input_cost_cny:
        retailInputCNY === null ? null : retailInputCNY / safeTextMarkup,
      upstream_output_cost_cny:
        retailInputCNY === null
          ? null
          : (retailInputCNY * completionRatio) / safeTextMarkup,
      upstream_cost_cny: null,
      fixed_price_cny: null,
      notes: '',
      enabled: hasTokenPrice,
    }
  }

  const currentRequestPriceCNY = hasFixedPrice
    ? fixedPriceUSD * safeExchangeRate
    : null
  return {
    model,
    modality,
    strategy: 'fixed_per_request',
    source_label: '',
    route_group: 'default',
    upstream_input_cost_cny: null,
    upstream_output_cost_cny: null,
    upstream_cost_cny: null,
    fixed_price_cny: currentRequestPriceCNY,
    notes: '',
    enabled: hasFixedPrice,
  }
}

export function createPricingWorkbenchRowsFromCandidates(
  candidates: PricingWorkbenchImportCandidate[],
  existingModels: Iterable<string>,
  maps: PricingWorkbenchModelMaps,
  usdExchangeRate: number,
  textMarkup: number
): { rows: PricingWorkbenchRow[]; skipped: number } {
  const existing = new Set(existingModels)
  const candidatesByModel = new Map<string, PricingWorkbenchImportCandidate[]>()

  for (const candidate of candidates) {
    const model = candidate.model.trim()
    if (!model || existing.has(model)) continue
    const grouped = candidatesByModel.get(model) ?? []
    grouped.push({ ...candidate, model })
    candidatesByModel.set(model, grouped)
  }

  const rows = [...candidatesByModel.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([model, modelCandidates]) => {
      const sourceLabels = [
        ...new Set(
          modelCandidates
            .map((candidate) => candidate.sourceLabel.trim())
            .filter(Boolean)
        ),
      ]
      const sourceLabel = sourceLabels.join('; ').slice(0, 191)
      const routeGroup =
        modelCandidates.find((candidate) => candidate.routeGroup.trim())
          ?.routeGroup ?? 'default'
      return {
        ...createPricingWorkbenchRow(model, maps, usdExchangeRate, textMarkup),
        source_label: sourceLabel,
        route_group: routeGroup,
        enabled: false,
      }
    })

  return {
    rows,
    skipped: candidates.length - rows.length,
  }
}

export function calculatePricingWorkbenchPreview(
  config: PricingWorkbenchConfig,
  row: PricingWorkbenchRow
): PricingWorkbenchPreview {
  const preview: PricingWorkbenchPreview = {
    model: row.model,
    modality: row.modality,
  }
  if (!row.enabled) return preview

  if (row.modality === 'text') {
    if (
      row.upstream_input_cost_cny === null ||
      row.upstream_output_cost_cny === null
    ) {
      return preview
    }
    preview.retail_input_cny = row.upstream_input_cost_cny * config.text_markup
    preview.retail_output_cny =
      row.upstream_output_cost_cny * config.text_markup
    preview.gross_margin = 1 - 1 / config.text_markup
    return preview
  }

  if (row.strategy === 'fixed_per_request') {
    if (row.fixed_price_cny === null) return preview
    preview.retail_request_cny = row.fixed_price_cny
  } else {
    if (row.upstream_cost_cny === null) return preview
    preview.retail_request_cny = Math.max(
      row.upstream_cost_cny + config.video_service_fee_cny,
      row.upstream_cost_cny * config.video_minimum_markup
    )
  }

  if (row.upstream_cost_cny !== null && (preview.retail_request_cny ?? 0) > 0) {
    preview.gross_margin =
      ((preview.retail_request_cny ?? 0) - row.upstream_cost_cny) /
      (preview.retail_request_cny ?? 1)
  }
  return preview
}
