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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { FormProvider, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getEnabledModels } from '@/features/channels/api'

import {
  calculatePricingWorkbenchPreview,
  createPricingWorkbenchRow,
  createPricingWorkbenchRowsFromCandidates,
  parsePricingMap,
  parsePricingStringMap,
  parsePricingWorkbenchConfig,
  type PricingWorkbenchConfig,
  type PricingWorkbenchImportBatch,
  type PricingWorkbenchModality,
  type PricingWorkbenchRow,
} from './pricing-workbench'
import { savePricingWorkbench } from './pricing-workbench-api'
import { PricingWorkbenchRowEditor } from './pricing-workbench-row'

type PricingWorkbenchPanelProps = {
  defaultValue: string
  usdExchangeRate: number
  modelPrice: string
  modelRatio: string
  completionRatio: string
  billingMode: string
  billingExpr: string
  importBatch?: PricingWorkbenchImportBatch
}

type Translate = (key: string) => string

function createPricingWorkbenchSchema(t: Translate) {
  const optionalMoney = z
    .number()
    .min(0, t('Price cannot be negative'))
    .max(1_000_000, t('Price is too large'))
    .nullable()
  const rowSchema = z
    .object({
      model: z.string().trim().min(1, t('Model name is required')).max(191),
      modality: z.enum(['text', 'image', 'video']),
      strategy: z.enum([
        'text_multiplier',
        'fixed_per_request',
        'video_cost_plus_fee',
      ]),
      source_label: z.string().trim().max(191),
      route_group: z.string().trim().max(191),
      upstream_input_cost_cny: optionalMoney,
      upstream_output_cost_cny: optionalMoney,
      upstream_cost_cny: optionalMoney,
      fixed_price_cny: optionalMoney,
      notes: z.string().trim().max(500),
      enabled: z.boolean(),
    })
    .superRefine((row, context) => {
      if (row.modality === 'text' && row.strategy !== 'text_multiplier') {
        context.addIssue({
          code: 'custom',
          path: ['strategy'],
          message: t('Text models must use text multiplier pricing'),
        })
      }
      if (row.modality === 'image' && row.strategy !== 'fixed_per_request') {
        context.addIssue({
          code: 'custom',
          path: ['strategy'],
          message: t('Image models must use fixed pricing'),
        })
      }
      if (
        row.modality === 'video' &&
        row.strategy !== 'video_cost_plus_fee' &&
        row.strategy !== 'fixed_per_request'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['strategy'],
          message: t('Video pricing strategy is invalid'),
        })
      }
      if (!row.enabled) return

      if (
        row.modality === 'text' &&
        (row.upstream_input_cost_cny === null ||
          row.upstream_input_cost_cny <= 0)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['upstream_input_cost_cny'],
          message: t('Enabled text models require an input cost'),
        })
      }
      if (row.modality === 'text' && row.upstream_output_cost_cny === null) {
        context.addIssue({
          code: 'custom',
          path: ['upstream_output_cost_cny'],
          message: t('Enabled text models require an output cost'),
        })
      }
      if (row.modality === 'image' && row.fixed_price_cny === null) {
        context.addIssue({
          code: 'custom',
          path: ['fixed_price_cny'],
          message: t('Enabled image models require a fixed public price'),
        })
      }
      if (
        row.modality === 'video' &&
        row.strategy === 'video_cost_plus_fee' &&
        row.upstream_cost_cny === null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['upstream_cost_cny'],
          message: t('Cost-based video models require an upstream cost'),
        })
      }
      if (
        row.modality === 'video' &&
        row.strategy === 'fixed_per_request' &&
        row.fixed_price_cny === null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['fixed_price_cny'],
          message: t('Fixed-price video models require a public price'),
        })
      }
    })

  return z
    .object({
      schema_version: z.literal(1),
      revision: z.number().int().min(0),
      updated_at: z.number().int().min(0),
      text_markup: z.number().min(1).max(100),
      video_service_fee_cny: z.number().min(0).max(1_000_000),
      video_minimum_markup: z.number().min(1).max(100),
      rows: z.array(rowSchema).max(1000),
    })
    .superRefine((config, context) => {
      const seen = new Set<string>()
      config.rows.forEach((row, index) => {
        const normalizedModel = row.model.trim()
        if (seen.has(normalizedModel)) {
          context.addIssue({
            code: 'custom',
            path: ['rows', index, 'model'],
            message: t('Each model can appear only once'),
          })
        }
        seen.add(normalizedModel)

        const preview = calculatePricingWorkbenchPreview(config, row)
        const computedPrices = [
          preview.retail_input_cny,
          preview.retail_output_cny,
          preview.retail_request_cny,
        ].filter((value): value is number => value !== undefined)
        if (computedPrices.some((value) => value > 1_000_000)) {
          context.addIssue({
            code: 'custom',
            path: ['rows', index],
            message: t('Computed public price is too large'),
          })
        }
      })
    })
}

function createEmptyRow(model: string): PricingWorkbenchRow {
  return {
    model,
    modality: 'text',
    strategy: 'text_multiplier',
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

export function PricingWorkbenchPanel({
  defaultValue,
  usdExchangeRate,
  modelPrice,
  modelRatio,
  completionRatio,
  billingMode,
  billingExpr,
  importBatch,
}: PricingWorkbenchPanelProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [newModel, setNewModel] = useState('')
  const [search, setSearch] = useState('')
  const [modalityFilter, setModalityFilter] = useState<
    PricingWorkbenchModality | 'all'
  >('all')
  const consumedImportBatch = useRef<string | null>(null)
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())
  const schema = useMemo(() => createPricingWorkbenchSchema(t), [t])
  const parsedDefault = useMemo(
    () => parsePricingWorkbenchConfig(defaultValue),
    [defaultValue]
  )
  const pricingMaps = useMemo(
    () => ({
      modelPrice: parsePricingMap(modelPrice),
      modelRatio: parsePricingMap(modelRatio),
      completionRatio: parsePricingMap(completionRatio),
      billingMode: parsePricingStringMap(billingMode),
      billingExpr: parsePricingStringMap(billingExpr),
    }),
    [billingExpr, billingMode, completionRatio, modelPrice, modelRatio]
  )
  const form = useForm<PricingWorkbenchConfig>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: parsedDefault,
  })
  const { append, fields, remove } = useFieldArray({
    control: form.control,
    name: 'rows',
  })
  const rows = useWatch({ control: form.control, name: 'rows' }) ?? []
  const textMarkup = useWatch({
    control: form.control,
    name: 'text_markup',
  })

  const enabledModelsQuery = useQuery({
    queryKey: ['enabled-models'],
    queryFn: getEnabledModels,
  })

  const saveMutation = useMutation({
    mutationFn: savePricingWorkbench,
    onSuccess: (response) => {
      if (!response.success || !response.data) {
        toast.error(response.message || t('Failed to save pricing workbench'))
        return
      }
      form.reset(
        parsePricingWorkbenchConfig(JSON.stringify(response.data.config))
      )
      setConfirmOpen(false)
      toast.success(t('Pricing workbench saved and pricing is now active'))
      queryClient.invalidateQueries({ queryKey: ['system-options'] })
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Failed to save pricing workbench'))
    },
  })

  useEffect(() => {
    form.reset(parsedDefault)
  }, [form, parsedDefault])

  useEffect(() => {
    if (!importBatch || consumedImportBatch.current === importBatch.id) return
    consumedImportBatch.current = importBatch.id

    const currentRows = form.getValues('rows')
    const imported = createPricingWorkbenchRowsFromCandidates(
      importBatch.candidates,
      currentRows.map((row) => row.model),
      pricingMaps,
      usdExchangeRate,
      form.getValues('text_markup')
    )
    if (imported.rows.length > 0) {
      append(imported.rows, { shouldFocus: false })
      toast.success(
        t('Added {{count}} candidate models to the pricing draft', {
          count: imported.rows.length,
        })
      )
    } else {
      toast.info(t('Selected candidate models are already in the workbench'))
    }
  }, [append, form, importBatch, pricingMaps, t, usdExchangeRate])

  const handleRemove = useCallback((index: number) => remove(index), [remove])

  const handleAddModel = useCallback(() => {
    const normalized = newModel.trim()
    if (!normalized) {
      toast.error(t('Enter a model name'))
      return
    }
    if (form.getValues('rows').some((row) => row.model === normalized)) {
      toast.error(t('This model is already in the workbench'))
      return
    }
    append(createEmptyRow(normalized), { shouldFocus: false })
    setNewModel('')
  }, [append, form, newModel, t])

  const handleImportEnabledModels = useCallback(() => {
    const models = enabledModelsQuery.data?.data
    if (!enabledModelsQuery.data?.success || !models) {
      toast.error(
        enabledModelsQuery.data?.message || t('Failed to load enabled models')
      )
      return
    }

    const existingModels = new Set(
      form.getValues('rows').map((row) => row.model)
    )
    const importedRows = [...new Set(models)]
      .filter((model) => !existingModels.has(model))
      .sort((left, right) => left.localeCompare(right))
      .map((model) =>
        createPricingWorkbenchRow(
          model,
          pricingMaps,
          usdExchangeRate,
          textMarkup
        )
      )

    if (importedRows.length === 0) {
      toast.info(t('All enabled models are already in the workbench'))
      return
    }
    append(importedRows, { shouldFocus: false })
    toast.success(
      t('Imported {{count}} enabled models', { count: importedRows.length })
    )
  }, [
    append,
    enabledModelsQuery.data,
    form,
    pricingMaps,
    t,
    textMarkup,
    usdExchangeRate,
  ])

  const handleValidSubmit = useCallback(() => setConfirmOpen(true), [])
  const handleInvalidSubmit = useCallback(() => {
    toast.error(t('Fix the highlighted pricing rules before saving'))
  }, [t])
  const handleConfirmSave = useCallback(() => {
    saveMutation.mutate(form.getValues())
  }, [form, saveMutation])

  const visibleRows = fields
    .map((field, index) => ({ field, index, row: rows[index] }))
    .filter(({ row }) => {
      if (!row) return false
      const matchesSearch =
        deferredSearch === '' ||
        row.model.toLowerCase().includes(deferredSearch) ||
        row.source_label.toLowerCase().includes(deferredSearch)
      const matchesModality =
        modalityFilter === 'all' || row.modality === modalityFilter
      return matchesSearch && matchesModality
    })
  const enabledCount = rows.filter((row) => row.enabled).length

  return (
    <FormProvider {...form}>
      <form
        className='space-y-5'
        onSubmit={form.handleSubmit(handleValidSubmit, handleInvalidSubmit)}
      >
        <Card size='sm'>
          <CardHeader>
            <CardTitle>{t('Pricing policy')}</CardTitle>
            <CardDescription>
              {t(
                'Text prices use upstream cost times markup. Video prices use the larger of cost plus service fee or cost times minimum markup. Image prices remain fixed per request.'
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className='grid gap-4 md:grid-cols-3'>
            <div className='grid gap-1.5'>
              <Label htmlFor='pricing-text-markup'>{t('Text markup')}</Label>
              <Input
                id='pricing-text-markup'
                type='number'
                min={1}
                max={100}
                step={0.01}
                {...form.register('text_markup', { valueAsNumber: true })}
              />
              <span className='text-muted-foreground text-xs'>
                {t('Default: 2× for input and output tokens')}
              </span>
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='pricing-video-fee'>
                {t('Video service fee (CNY)')}
              </Label>
              <Input
                id='pricing-video-fee'
                type='number'
                min={0}
                max={1_000_000}
                step={0.01}
                {...form.register('video_service_fee_cny', {
                  valueAsNumber: true,
                })}
              />
              <span className='text-muted-foreground text-xs'>
                {t('Default: ¥0.50 per request')}
              </span>
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='pricing-video-minimum-markup'>
                {t('Video minimum markup')}
              </Label>
              <Input
                id='pricing-video-minimum-markup'
                type='number'
                min={1}
                max={100}
                step={0.01}
                {...form.register('video_minimum_markup', {
                  valueAsNumber: true,
                })}
              />
              <span className='text-muted-foreground text-xs'>
                {t('Default: at least 1.2× upstream cost')}
              </span>
            </div>
          </CardContent>
          <CardContent>
            <p className='text-warning text-xs leading-5'>
              {t(
                'Public price previews assume a group multiplier of 1. Keep routing groups at 1 in Group Pricing if Default, Premium, and High Quality should charge the same price.'
              )}
            </p>
          </CardContent>
        </Card>

        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              value={newModel}
              onChange={(event) => setNewModel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                handleAddModel()
              }}
              placeholder={t('Model name')}
              aria-label={t('New model name')}
              className='w-64'
            />
            <Button type='button' variant='outline' onClick={handleAddModel}>
              {t('Add model')}
            </Button>
            <Button
              type='button'
              variant='outline'
              onClick={handleImportEnabledModels}
              disabled={enabledModelsQuery.isPending}
            >
              {enabledModelsQuery.isPending
                ? t('Loading models...')
                : t('Import enabled models')}
            </Button>
          </div>
          <div className='flex items-center gap-2'>
            <Badge variant='outline'>
              {t('{{count}} rules', { count: rows.length })}
            </Badge>
            <Badge variant='secondary'>
              {t('{{count}} active', { count: enabledCount })}
            </Badge>
          </div>
        </div>
        <p className='text-muted-foreground text-xs leading-5'>
          {t(
            'Imported rows preserve current public prices. Text upstream costs are back-calculated estimates from the current price and selected markup; verify them against the upstream bill before changing prices. Tiered-expression models are imported disabled to protect their existing rules.'
          )}
        </p>

        <div className='flex flex-wrap items-center gap-2'>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('Search model or pricing source')}
            aria-label={t('Search pricing rules')}
            className='w-72'
          />
          <Select
            items={[
              { value: 'all', label: t('All modalities') },
              { value: 'text', label: t('Text') },
              { value: 'image', label: t('Image') },
              { value: 'video', label: t('Video') },
            ]}
            value={modalityFilter}
            onValueChange={(value) =>
              value !== null && setModalityFilter(value)
            }
          >
            <SelectTrigger className='w-40' aria-label={t('Modality filter')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value='all'>{t('All modalities')}</SelectItem>
                <SelectItem value='text'>{t('Text')}</SelectItem>
                <SelectItem value='image'>{t('Image')}</SelectItem>
                <SelectItem value='video'>{t('Video')}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className='max-h-[58vh] overflow-auto rounded-xl border'>
          <Table className='min-w-[1180px]'>
            <TableHeader className='bg-muted/80 sticky top-0 z-10 backdrop-blur'>
              <TableRow>
                <TableHead>{t('Model / pricing source')}</TableHead>
                <TableHead>{t('Type / route group')}</TableHead>
                <TableHead>{t('Cost or fixed price (CNY)')}</TableHead>
                <TableHead>{t('Public price preview')}</TableHead>
                <TableHead>{t('Notes')}</TableHead>
                <TableHead>{t('Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map(({ field, index }) => (
                <PricingWorkbenchRowEditor
                  key={field.id}
                  index={index}
                  onRemove={handleRemove}
                />
              ))}
            </TableBody>
          </Table>
          {visibleRows.length === 0 && (
            <div className='text-muted-foreground px-4 py-12 text-center text-sm'>
              {rows.length === 0
                ? t('Add a model or import enabled models to begin.')
                : t('No pricing rules match the current filters.')}
            </div>
          )}
        </div>

        <div className='flex flex-wrap items-center justify-between gap-3'>
          <p className='text-muted-foreground max-w-3xl text-xs leading-5'>
            {t(
              'Saving recompiles the enabled rows into the live model pricing maps. Route group and pricing source are reference fields; channel routing remains controlled by channel groups and upstream keys.'
            )}
          </p>
          <Button type='submit' disabled={saveMutation.isPending}>
            {saveMutation.isPending
              ? t('Saving...')
              : t('Save and activate pricing')}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('Activate these pricing rules?')}
        desc={t(
          'Enabled rows will replace their current live token or per-request prices in one atomic update. Disabled and unlisted models will remain unchanged.'
        )}
        isLoading={saveMutation.isPending}
        handleConfirm={handleConfirmSave}
        confirmText={t('Save and activate')}
      />
    </FormProvider>
  )
}
