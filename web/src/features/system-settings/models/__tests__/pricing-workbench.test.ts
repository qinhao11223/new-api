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
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PRICING_WORKBENCH_CONFIG,
  calculatePricingWorkbenchPreview,
  classifyPricingModality,
  createPricingWorkbenchRow,
  createPricingWorkbenchRowsFromCandidates,
  parsePricingWorkbenchConfig,
  type PricingWorkbenchRow,
} from '../pricing-workbench'

describe('pricing workbench', () => {
  it('classifies common image and video model names', () => {
    expect(classifyPricingModality('gemini-3-pro-image-preview')).toBe('image')
    expect(classifyPricingModality('gpt-image-2')).toBe('image')
    expect(classifyPricingModality('veo-3.1-fast')).toBe('video')
    expect(classifyPricingModality('seedance-2.0')).toBe('video')
    expect(classifyPricingModality('gpt-5.6')).toBe('text')
  })

  it('imports current prices without silently increasing them', () => {
    const maps = {
      modelPrice: { 'gpt-image-2': 0.1, 'veo-3.1': 0.2 },
      modelRatio: { 'gpt-5.6': 1 },
      completionRatio: { 'gpt-5.6': 2 },
    }

    const text = createPricingWorkbenchRow('gpt-5.6', maps, 7.3, 2)
    expect(text.enabled).toBe(true)
    expect(text.upstream_input_cost_cny).toBeCloseTo(7.3)
    expect(text.upstream_output_cost_cny).toBeCloseTo(14.6)

    const image = createPricingWorkbenchRow('gpt-image-2', maps, 7.3, 2)
    expect(image.strategy).toBe('fixed_per_request')
    expect(image.fixed_price_cny).toBeCloseTo(0.73)

    const video = createPricingWorkbenchRow('veo-3.1', maps, 7.3, 2)
    expect(video.strategy).toBe('fixed_per_request')
    expect(video.fixed_price_cny).toBeCloseTo(1.46)
    expect(video.upstream_cost_cny).toBeNull()
  })

  it('uses the larger video price floor', () => {
    const lowCostRow: PricingWorkbenchRow = {
      model: 'video-low',
      modality: 'video',
      strategy: 'video_cost_plus_fee',
      source_label: '',
      route_group: 'default',
      upstream_input_cost_cny: null,
      upstream_output_cost_cny: null,
      upstream_cost_cny: 1,
      fixed_price_cny: null,
      notes: '',
      enabled: true,
    }
    const highCostRow = {
      ...lowCostRow,
      model: 'video-high',
      upstream_cost_cny: 10,
    }

    expect(
      calculatePricingWorkbenchPreview(
        DEFAULT_PRICING_WORKBENCH_CONFIG,
        lowCostRow
      ).retail_request_cny
    ).toBe(1.5)
    expect(
      calculatePricingWorkbenchPreview(
        DEFAULT_PRICING_WORKBENCH_CONFIG,
        highCostRow
      ).retail_request_cny
    ).toBe(12)
  })

  it('imports tiered-expression models disabled without deriving a replacement price', () => {
    const row = createPricingWorkbenchRow(
      'tiered-model',
      {
        modelPrice: {},
        modelRatio: { 'tiered-model': 1 },
        completionRatio: { 'tiered-model': 2 },
        billingMode: { 'tiered-model': 'tiered_expr' },
        billingExpr: { 'tiered-model': 'input_tokens' },
      },
      7.3,
      2
    )

    expect(row.enabled).toBe(false)
    expect(row.upstream_input_cost_cny).toBeNull()
    expect(row.upstream_output_cost_cny).toBeNull()
  })

  it('deduplicates upstream variants into disabled pricing drafts', () => {
    const imported = createPricingWorkbenchRowsFromCandidates(
      [
        {
          model: 'gpt-5.6',
          sourceLabel: 'GRS AI / key 1 (aaaa1111)',
          routeGroup: 'default',
        },
        {
          model: 'gpt-5.6',
          sourceLabel: 'OpenLux / key 2 (bbbb2222)',
          routeGroup: 'default',
        },
        {
          model: 'existing-model',
          sourceLabel: 'OpenLux / key 1 (cccc3333)',
          routeGroup: 'premium',
        },
      ],
      ['existing-model'],
      {
        modelPrice: {},
        modelRatio: { 'gpt-5.6': 1 },
        completionRatio: { 'gpt-5.6': 2 },
      },
      7.3,
      2
    )

    expect(imported.rows).toHaveLength(1)
    expect(imported.rows[0]).toMatchObject({
      model: 'gpt-5.6',
      route_group: 'default',
      enabled: false,
    })
    expect(imported.rows[0].source_label).toContain('GRS AI')
    expect(imported.rows[0].source_label).toContain('OpenLux')
    expect(imported.skipped).toBe(2)
  })

  it('falls back safely when persisted JSON is malformed', () => {
    const parsed = parsePricingWorkbenchConfig('{not-json')

    expect(parsed).toEqual(DEFAULT_PRICING_WORKBENCH_CONFIG)
    expect(parsed).not.toBe(DEFAULT_PRICING_WORKBENCH_CONFIG)
  })

  it('normalizes omitted optional row fields from backend JSON', () => {
    const parsed = parsePricingWorkbenchConfig(
      JSON.stringify({
        ...DEFAULT_PRICING_WORKBENCH_CONFIG,
        rows: [
          {
            model: 'gpt-5.6',
            modality: 'text',
            strategy: 'text_multiplier',
            enabled: false,
          },
        ],
      })
    )

    expect(parsed.rows[0]).toMatchObject({
      source_label: '',
      route_group: '',
      upstream_input_cost_cny: null,
      upstream_output_cost_cny: null,
      upstream_cost_cny: null,
      fixed_price_cny: null,
      notes: '',
    })
  })
})
