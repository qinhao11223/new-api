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
import { useMutation, useQuery } from '@tanstack/react-query'
import { useCallback, useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import type { PricingWorkbenchImportCandidate } from './pricing-workbench'
import {
  flattenUpstreamModelPoolResults,
  toPricingWorkbenchImportCandidates,
  upstreamModelPoolSourceLabel,
  type UpstreamModelPoolDiscoveryResult,
  type UpstreamModelPoolSource,
} from './upstream-model-pool'
import {
  discoverUpstreamModelPool,
  getUpstreamModelPoolSources,
} from './upstream-model-pool-api'

const DISCOVERY_BATCH_SIZE = 8
const PAGE_SIZE = 50
const MODALITY_LABEL_KEYS = {
  text: 'Text',
  image: 'Image',
  video: 'Video',
} as const

type UpstreamModelPoolPanelProps = {
  onAddToPricingDraft: (candidates: PricingWorkbenchImportCandidate[]) => void
}

type DiscoveryRequest = {
  sources: UpstreamModelPoolSource[]
  replace: boolean
}

export function UpstreamModelPoolPanel({
  onAddToPricingDraft,
}: UpstreamModelPoolPanelProps) {
  const { t } = useTranslation()
  const [results, setResults] = useState<UpstreamModelPoolDiscoveryResult[]>([])
  const [progress, setProgress] = useState(0)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [modalityFilter, setModalityFilter] = useState('all')
  const [availabilityFilter, setAvailabilityFilter] = useState('unconfigured')
  const [routeGroup, setRouteGroup] = useState('default')
  const [selectedIDs, setSelectedIDs] = useState<Set<string>>(() => new Set())
  const [page, setPage] = useState(1)
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())

  const sourcesQuery = useQuery({
    queryKey: ['upstream-model-pool-sources'],
    queryFn: getUpstreamModelPoolSources,
  })
  const sources = useMemo(
    () => sourcesQuery.data?.data ?? [],
    [sourcesQuery.data?.data]
  )

  const discoveryMutation = useMutation({
    mutationFn: async ({
      sources: requestedSources,
      replace,
    }: DiscoveryRequest) => {
      const discovered: UpstreamModelPoolDiscoveryResult[] = []
      setProgress(0)
      for (
        let index = 0;
        index < requestedSources.length;
        index += DISCOVERY_BATCH_SIZE
      ) {
        const batch = requestedSources.slice(
          index,
          index + DISCOVERY_BATCH_SIZE
        )
        const response = await discoverUpstreamModelPool(
          batch.map((source) => ({
            channel_id: source.channel_id,
            key_index: source.key_index,
          }))
        )
        if (!response.success || !response.data) {
          throw new Error(
            response.message || t('Failed to discover upstream models')
          )
        }
        discovered.push(...response.data)
        setProgress(
          Math.round(
            (Math.min(index + batch.length, requestedSources.length) /
              requestedSources.length) *
              100
          )
        )
      }
      return { discovered, replace }
    },
    onSuccess: ({ discovered, replace }) => {
      setResults((current) => {
        if (replace) return discovered
        const merged = new Map(
          current.map((result) => [result.source.id, result])
        )
        discovered.forEach((result) => merged.set(result.source.id, result))
        return [...merged.values()]
      })
      setSelectedIDs(new Set())
      const modelCount = discovered.reduce(
        (count, result) => count + result.models.length,
        0
      )
      toast.success(
        t('Discovered {{count}} upstream model variants', {
          count: modelCount,
        })
      )
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Failed to discover upstream models'))
    },
  })

  const allRows = useMemo(
    () => flattenUpstreamModelPoolResults(results),
    [results]
  )
  const visibleRows = useMemo(
    () =>
      allRows.filter((row) => {
        const matchesSearch =
          deferredSearch === '' ||
          row.model.toLowerCase().includes(deferredSearch) ||
          row.source.channel_name.toLowerCase().includes(deferredSearch) ||
          row.source.endpoint_host.toLowerCase().includes(deferredSearch)
        const matchesSource =
          sourceFilter === 'all' || row.source.id === sourceFilter
        const matchesModality =
          modalityFilter === 'all' || row.modality === modalityFilter
        const matchesAvailability =
          availabilityFilter === 'all' ||
          (availabilityFilter === 'configured'
            ? row.enabled_on_channel
            : !row.enabled_on_channel)
        return (
          matchesSearch &&
          matchesSource &&
          matchesModality &&
          matchesAvailability
        )
      }),
    [allRows, availabilityFilter, deferredSearch, modalityFilter, sourceFilter]
  )
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = visibleRows.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  )
  const selectedRows = allRows.filter((row) => selectedIDs.has(row.id))
  const selectedOnPage = pageRows.filter((row) =>
    selectedIDs.has(row.id)
  ).length
  const failedResults = results.filter((result) => result.error)

  const handleDiscoverAll = useCallback(() => {
    if (sources.length === 0) {
      toast.error(t('No enabled upstream sources are available'))
      return
    }
    discoveryMutation.mutate({ sources, replace: true })
  }, [discoveryMutation, sources, t])

  const handleDiscoverCurrent = useCallback(() => {
    const source = sources.find((item) => item.id === sourceFilter)
    if (!source) return
    discoveryMutation.mutate({ sources: [source], replace: false })
  }, [discoveryMutation, sourceFilter, sources])

  const handleTogglePage = useCallback(
    (checked: boolean) => {
      setSelectedIDs((current) => {
        const next = new Set(current)
        pageRows.forEach((row) => {
          if (checked) next.add(row.id)
          else next.delete(row.id)
        })
        return next
      })
    },
    [pageRows]
  )

  const handleAddToPricingDraft = useCallback(() => {
    if (selectedRows.length === 0) {
      toast.error(t('Select at least one candidate model'))
      return
    }
    onAddToPricingDraft(
      toPricingWorkbenchImportCandidates(selectedRows, routeGroup)
    )
    setSelectedIDs(new Set())
  }, [onAddToPricingDraft, routeGroup, selectedRows, t])

  const sourceItems = [
    { value: 'all', label: t('All upstream sources') },
    ...sources.map((source) => ({
      value: source.id,
      label: upstreamModelPoolSourceLabel(source),
    })),
  ]
  const modalityItems = [
    { value: 'all', label: t('All modalities') },
    { value: 'text', label: t('Text') },
    { value: 'image', label: t('Image') },
    { value: 'video', label: t('Video') },
  ]
  const availabilityItems = [
    { value: 'unconfigured', label: t('Not enabled on source') },
    { value: 'configured', label: t('Already enabled on source') },
    { value: 'all', label: t('All source statuses') },
  ]
  const routeGroupItems = [
    { value: 'default', label: t('Default') },
    { value: 'premium', label: t('Premium') },
    { value: 'high_quality', label: t('High quality') },
  ]

  return (
    <div className='flex flex-col gap-5'>
      <Card size='sm'>
        <CardHeader>
          <CardTitle>{t('Upstream model discovery')}</CardTitle>
          <CardDescription>
            {t(
              'Fetch model catalogs from each enabled channel key. Discovery only creates candidates and never enables a model or changes routing.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-wrap items-center gap-3'>
          <Button
            type='button'
            onClick={handleDiscoverAll}
            disabled={
              sourcesQuery.isPending ||
              discoveryMutation.isPending ||
              sources.length === 0
            }
          >
            {discoveryMutation.isPending
              ? t('Discovering upstream models...')
              : t('Discover all upstream models')}
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={handleDiscoverCurrent}
            disabled={sourceFilter === 'all' || discoveryMutation.isPending}
          >
            {t('Refresh current source')}
          </Button>
          <Badge variant='outline'>
            {t('{{count}} enabled sources', { count: sources.length })}
          </Badge>
          <Badge variant='secondary'>
            {t('{{count}} discovered variants', { count: allRows.length })}
          </Badge>
        </CardContent>
        {discoveryMutation.isPending && (
          <CardContent>
            <Progress value={progress}>
              <ProgressLabel>{t('Discovery progress')}</ProgressLabel>
              <ProgressValue>{() => `${progress}%`}</ProgressValue>
            </Progress>
          </CardContent>
        )}
      </Card>

      <Alert>
        <AlertTitle>{t('Candidates stay inactive')}</AlertTitle>
        <AlertDescription>
          {t(
            'Adding candidates only prepares disabled pricing rows. Route group is a planning label here; live channel groups and enabled models must still be published separately after review.'
          )}
        </AlertDescription>
      </Alert>

      {failedResults.length > 0 && (
        <Alert variant='destructive'>
          <AlertTitle>
            {t('{{count}} upstream sources failed', {
              count: failedResults.length,
            })}
          </AlertTitle>
          <AlertDescription>
            {failedResults
              .map(
                (result) =>
                  `${result.source.channel_name} / key ${result.source.key_index + 1}: ${result.error}`
              )
              .join('；')}
          </AlertDescription>
        </Alert>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('Search model, channel, or endpoint')}
          aria-label={t('Search upstream model candidates')}
          className='w-72'
        />
        <Select
          items={sourceItems}
          value={sourceFilter}
          onValueChange={(value) => value !== null && setSourceFilter(value)}
        >
          <SelectTrigger
            className='w-72'
            aria-label={t('Upstream source filter')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {sourceItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          items={modalityItems}
          value={modalityFilter}
          onValueChange={(value) => value !== null && setModalityFilter(value)}
        >
          <SelectTrigger className='w-40' aria-label={t('Modality filter')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {modalityItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          items={availabilityItems}
          value={availabilityFilter}
          onValueChange={(value) =>
            value !== null && setAvailabilityFilter(value)
          }
        >
          <SelectTrigger
            className='w-48'
            aria-label={t('Source status filter')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {availabilityItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {results.length === 0 ? (
        <Empty className='min-h-72 border'>
          <EmptyHeader>
            <EmptyTitle>{t('No upstream candidates yet')}</EmptyTitle>
            <EmptyDescription>
              {t(
                'Run discovery to fetch the current model list for every enabled upstream key.'
              )}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              type='button'
              onClick={handleDiscoverAll}
              disabled={sources.length === 0 || discoveryMutation.isPending}
            >
              {t('Discover all upstream models')}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className='overflow-hidden rounded-xl border'>
          <div className='max-h-[56vh] overflow-auto'>
            <Table className='min-w-[1040px]'>
              <TableHeader className='bg-muted/80 sticky top-0 backdrop-blur'>
                <TableRow>
                  <TableHead className='w-12'>
                    <Checkbox
                      checked={
                        pageRows.length > 0 &&
                        selectedOnPage === pageRows.length
                      }
                      indeterminate={
                        selectedOnPage > 0 && selectedOnPage < pageRows.length
                      }
                      onCheckedChange={(value) => handleTogglePage(!!value)}
                      aria-label={t('Select current page')}
                    />
                  </TableHead>
                  <TableHead>{t('Model')}</TableHead>
                  <TableHead>{t('Modality')}</TableHead>
                  <TableHead>{t('Upstream channel')}</TableHead>
                  <TableHead>{t('Key line')}</TableHead>
                  <TableHead>{t('Endpoint')}</TableHead>
                  <TableHead>{t('Source status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((row) => (
                  <TableRow key={row.id} className='[content-visibility:auto]'>
                    <TableCell>
                      <Checkbox
                        checked={selectedIDs.has(row.id)}
                        onCheckedChange={(value) =>
                          setSelectedIDs((current) => {
                            const next = new Set(current)
                            if (value) next.add(row.id)
                            else next.delete(row.id)
                            return next
                          })
                        }
                        aria-label={t('Select {{model}}', { model: row.model })}
                      />
                    </TableCell>
                    <TableCell className='font-mono text-xs font-medium'>
                      {row.model}
                    </TableCell>
                    <TableCell>
                      <Badge variant='outline'>
                        {t(MODALITY_LABEL_KEYS[row.modality])}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className='flex flex-col gap-1'>
                        <span className='font-medium'>
                          {row.source.channel_name}
                        </span>
                        <span className='text-muted-foreground text-xs'>
                          {row.source.channel_type_name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      #{row.source.key_index + 1} · {row.source.key_fingerprint}
                    </TableCell>
                    <TableCell className='text-muted-foreground text-xs'>
                      {row.source.endpoint_host || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.enabled_on_channel ? 'secondary' : 'outline'
                        }
                      >
                        {row.enabled_on_channel
                          ? t('Already enabled')
                          : t('Candidate only')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {visibleRows.length === 0 && (
            <Empty className='min-h-48 border-0'>
              <EmptyHeader>
                <EmptyTitle>{t('No candidates match the filters')}</EmptyTitle>
                <EmptyDescription>
                  {t('Adjust the source, modality, status, or search filters.')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <div className='flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2'>
            <span className='text-muted-foreground text-xs'>
              {t('Page {{page}} of {{pages}} · {{count}} candidates', {
                page: safePage,
                pages: pageCount,
                count: visibleRows.length,
              })}
            </span>
            <div className='flex items-center gap-2'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => setPage(Math.max(1, safePage - 1))}
                disabled={safePage <= 1}
              >
                {t('Previous')}
              </Button>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => setPage(Math.min(pageCount, safePage + 1))}
                disabled={safePage >= pageCount}
              >
                {t('Next')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Card size='sm'>
        <CardHeader>
          <CardTitle>{t('Add selected candidates to pricing draft')}</CardTitle>
          <CardDescription>
            {t(
              'Duplicate model names from different upstream keys are kept as source references but become one pricing row because public text pricing is shared.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-wrap items-center gap-3'>
          <Select
            items={routeGroupItems}
            value={routeGroup}
            onValueChange={(value) => value !== null && setRouteGroup(value)}
          >
            <SelectTrigger className='w-48' aria-label={t('Route group')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {routeGroupItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            type='button'
            onClick={handleAddToPricingDraft}
            disabled={selectedRows.length === 0}
          >
            {t('Add {{count}} selected variants to pricing draft', {
              count: selectedRows.length,
            })}
          </Button>
          <span className='text-muted-foreground text-xs'>
            {t('Pricing rows are added disabled for manual cost review.')}
          </span>
        </CardContent>
      </Card>
    </div>
  )
}
