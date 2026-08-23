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
  flattenUpstreamModelPoolResults,
  toPricingWorkbenchImportCandidates,
  type UpstreamModelPoolDiscoveryResult,
} from '../upstream-model-pool'

const result: UpstreamModelPoolDiscoveryResult = {
  source: {
    id: '4:1',
    channel_id: 4,
    channel_name: 'OpenLux',
    channel_type: 1,
    channel_type_name: 'OpenAI',
    channel_group: 'default',
    channel_tag: '',
    endpoint_host: 'api.openlux.ai',
    key_index: 1,
    key_fingerprint: 'abcd1234',
  },
  models: [
    {
      id: '4:1:gpt-5.6',
      model: 'gpt-5.6',
      enabled_on_channel: false,
    },
    {
      id: '4:1:veo-3.1',
      model: 'veo-3.1',
      enabled_on_channel: true,
    },
  ],
  duration_ms: 120,
}

describe('upstream model pool', () => {
  it('keeps source variants while classifying model modalities', () => {
    const rows = flattenUpstreamModelPoolResults([result])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ model: 'gpt-5.6', modality: 'text' })
    expect(rows[1]).toMatchObject({ model: 'veo-3.1', modality: 'video' })
    expect(rows[0].source.id).toBe('4:1')
  })

  it('carries source and route group into pricing candidates', () => {
    const candidates = toPricingWorkbenchImportCandidates(
      flattenUpstreamModelPoolResults([result]),
      'premium'
    )

    expect(candidates[0]).toEqual({
      model: 'gpt-5.6',
      sourceLabel: 'OpenLux / key 2 (abcd1234)',
      routeGroup: 'premium',
    })
  })
})
