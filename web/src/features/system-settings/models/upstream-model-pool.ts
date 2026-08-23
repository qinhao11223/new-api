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
import {
  classifyPricingModality,
  type PricingWorkbenchImportCandidate,
  type PricingWorkbenchModality,
} from './pricing-workbench'

export type UpstreamModelPoolSource = {
  id: string
  channel_id: number
  channel_name: string
  channel_type: number
  channel_type_name: string
  channel_group: string
  channel_tag: string
  endpoint_host: string
  key_index: number
  key_fingerprint: string
}

export type UpstreamModelPoolSourceRef = {
  channel_id: number
  key_index: number
}

export type UpstreamModelPoolCandidate = {
  id: string
  model: string
  enabled_on_channel: boolean
}

export type UpstreamModelPoolDiscoveryResult = {
  source: UpstreamModelPoolSource
  models: UpstreamModelPoolCandidate[]
  error?: string
  duration_ms: number
}

export type UpstreamModelPoolRow = UpstreamModelPoolCandidate & {
  source: UpstreamModelPoolSource
  modality: PricingWorkbenchModality
}

export type UpstreamModelPoolApiResponse<T> = {
  success: boolean
  message?: string
  data?: T
}

export function flattenUpstreamModelPoolResults(
  results: UpstreamModelPoolDiscoveryResult[]
): UpstreamModelPoolRow[] {
  return results.flatMap((result) =>
    result.models.map((candidate) => ({
      ...candidate,
      source: result.source,
      modality: classifyPricingModality(candidate.model),
    }))
  )
}

export function upstreamModelPoolSourceLabel(
  source: UpstreamModelPoolSource
): string {
  return `${source.channel_name} / key ${source.key_index + 1} (${source.key_fingerprint})`
}

export function toPricingWorkbenchImportCandidates(
  rows: UpstreamModelPoolRow[],
  routeGroup: string
): PricingWorkbenchImportCandidate[] {
  return rows.map((row) => ({
    model: row.model,
    sourceLabel: upstreamModelPoolSourceLabel(row.source),
    routeGroup,
  }))
}
