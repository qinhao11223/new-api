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
import { memo, useCallback } from 'react'
import {
  useController,
  useFormContext,
  useWatch,
  type FieldPath,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { TableCell, TableRow } from '@/components/ui/table'

import {
  calculatePricingWorkbenchPreview,
  strategyForModality,
  type PricingWorkbenchConfig,
  type PricingWorkbenchModality,
  type PricingWorkbenchStrategy,
} from './pricing-workbench'

type PricingWorkbenchRowEditorProps = {
  index: number
  onRemove: (index: number) => void
}

type NullableNumberInputProps = {
  name: FieldPath<PricingWorkbenchConfig>
  label: string
  min?: number
  max?: number
  step?: number
  className?: string
}

function NullableNumberInput({
  name,
  label,
  min = 0,
  max = 1_000_000,
  step = 0.000001,
  className,
}: NullableNumberInputProps) {
  const { control } = useFormContext<PricingWorkbenchConfig>()
  const { field, fieldState } = useController({ control, name })

  return (
    <Input
      ref={field.ref}
      name={field.name}
      type='number'
      min={min}
      max={max}
      step={step}
      value={typeof field.value === 'number' ? field.value : ''}
      onBlur={field.onBlur}
      onChange={(event) => {
        const value = event.target.value
        field.onChange(value === '' ? null : Number(value))
      }}
      aria-label={label}
      aria-invalid={fieldState.invalid}
      className={className}
    />
  )
}

function formatCNY(value: number | undefined) {
  if (value === undefined) return '—'
  return `¥${value.toFixed(6).replace(/\.?0+$/, '')}`
}

export const PricingWorkbenchRowEditor = memo(
  function PricingWorkbenchRowEditor({
    index,
    onRemove,
  }: PricingWorkbenchRowEditorProps) {
    const { t } = useTranslation()
    const { control, register, setValue } =
      useFormContext<PricingWorkbenchConfig>()
    const row = useWatch({ control, name: `rows.${index}` })
    const textMarkup = useWatch({ control, name: 'text_markup' })
    const videoServiceFeeCNY = useWatch({
      control,
      name: 'video_service_fee_cny',
    })
    const videoMinimumMarkup = useWatch({
      control,
      name: 'video_minimum_markup',
    })

    const handleModalityChange = useCallback(
      (value: PricingWorkbenchModality | null) => {
        if (value === null) return
        setValue(`rows.${index}.modality`, value, { shouldDirty: true })
        setValue(`rows.${index}.strategy`, strategyForModality(value), {
          shouldDirty: true,
        })
      },
      [index, setValue]
    )
    const handleStrategyChange = useCallback(
      (value: PricingWorkbenchStrategy | null) => {
        if (value === null) return
        setValue(`rows.${index}.strategy`, value, { shouldDirty: true })
      },
      [index, setValue]
    )
    const handleEnabledChange = useCallback(
      (checked: boolean) => {
        setValue(`rows.${index}.enabled`, checked, { shouldDirty: true })
      },
      [index, setValue]
    )
    const handleRemove = useCallback(() => onRemove(index), [index, onRemove])

    if (!row) return null

    const configForPreview: PricingWorkbenchConfig = {
      schema_version: 1,
      revision: 0,
      updated_at: 0,
      text_markup: textMarkup,
      video_service_fee_cny: videoServiceFeeCNY,
      video_minimum_markup: videoMinimumMarkup,
      rows: [],
    }
    const preview = calculatePricingWorkbenchPreview(configForPreview, row)
    const retailSummary =
      row.modality === 'text'
        ? `${t('Input')} ${formatCNY(preview.retail_input_cny)} / ${t('Output')} ${formatCNY(preview.retail_output_cny)}`
        : formatCNY(preview.retail_request_cny)

    return (
      <TableRow className={!row.enabled ? 'opacity-65' : undefined}>
        <TableCell className='min-w-56 align-top'>
          <Input
            {...register(`rows.${index}.model`)}
            aria-label={t('Model name')}
          />
          <Input
            {...register(`rows.${index}.source_label`)}
            aria-label={t('Pricing source or upstream key label')}
            placeholder={t('Pricing source or upstream key label')}
            className='mt-1.5'
          />
        </TableCell>
        <TableCell className='min-w-32 align-top'>
          <Select
            items={[
              { value: 'text', label: t('Text') },
              { value: 'image', label: t('Image') },
              { value: 'video', label: t('Video') },
            ]}
            value={row.modality}
            onValueChange={handleModalityChange}
          >
            <SelectTrigger className='w-full' aria-label={t('Modality')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value='text'>{t('Text')}</SelectItem>
                <SelectItem value='image'>{t('Image')}</SelectItem>
                <SelectItem value='video'>{t('Video')}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Input
            {...register(`rows.${index}.route_group`)}
            aria-label={t('Route group')}
            placeholder={t('Route group')}
            className='mt-1.5'
          />
        </TableCell>
        <TableCell className='min-w-48 align-top'>
          {row.modality === 'text' && (
            <div className='grid grid-cols-2 gap-1.5'>
              <NullableNumberInput
                name={`rows.${index}.upstream_input_cost_cny`}
                label={t('Upstream input cost in CNY per 1M tokens')}
              />
              <NullableNumberInput
                name={`rows.${index}.upstream_output_cost_cny`}
                label={t('Upstream output cost in CNY per 1M tokens')}
              />
              <span className='text-muted-foreground text-xs'>
                {t('Input / 1M tokens')}
              </span>
              <span className='text-muted-foreground text-xs'>
                {t('Output / 1M tokens')}
              </span>
            </div>
          )}
          {row.modality === 'image' && (
            <div className='grid grid-cols-2 gap-1.5'>
              <NullableNumberInput
                name={`rows.${index}.fixed_price_cny`}
                label={t('Fixed public price in CNY per request')}
              />
              <NullableNumberInput
                name={`rows.${index}.upstream_cost_cny`}
                label={t('Optional upstream cost in CNY per request')}
              />
              <span className='text-muted-foreground text-xs'>
                {t('Public price / request')}
              </span>
              <span className='text-muted-foreground text-xs'>
                {t('Upstream cost (optional)')}
              </span>
            </div>
          )}
          {row.modality === 'video' && (
            <div className='space-y-1.5'>
              <Select
                items={[
                  {
                    value: 'video_cost_plus_fee',
                    label: t('Upstream cost + service fee'),
                  },
                  {
                    value: 'fixed_per_request',
                    label: t('Fixed public price'),
                  },
                ]}
                value={row.strategy}
                onValueChange={handleStrategyChange}
              >
                <SelectTrigger className='w-full' aria-label={t('Strategy')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value='video_cost_plus_fee'>
                      {t('Upstream cost + service fee')}
                    </SelectItem>
                    <SelectItem value='fixed_per_request'>
                      {t('Fixed public price')}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              {row.strategy === 'video_cost_plus_fee' ? (
                <NullableNumberInput
                  name={`rows.${index}.upstream_cost_cny`}
                  label={t('Upstream cost in CNY per request')}
                />
              ) : (
                <div className='grid grid-cols-2 gap-1.5'>
                  <NullableNumberInput
                    name={`rows.${index}.fixed_price_cny`}
                    label={t('Fixed public price in CNY per request')}
                  />
                  <NullableNumberInput
                    name={`rows.${index}.upstream_cost_cny`}
                    label={t('Optional upstream cost in CNY per request')}
                  />
                </div>
              )}
            </div>
          )}
        </TableCell>
        <TableCell className='min-w-48 align-top'>
          <div className='font-medium'>{retailSummary}</div>
          {preview.gross_margin !== undefined && (
            <div className='text-muted-foreground mt-1 text-xs'>
              {t('Estimated gross margin')}:&nbsp;
              {(preview.gross_margin * 100).toFixed(1)}%
            </div>
          )}
          <div className='mt-1.5'>
            <Badge variant='outline'>
              {row.strategy === 'text_multiplier' && t('Text multiplier')}
              {row.strategy === 'fixed_per_request' && t('Fixed price')}
              {row.strategy === 'video_cost_plus_fee' &&
                t('Cost + fee / minimum markup')}
            </Badge>
          </div>
        </TableCell>
        <TableCell className='min-w-52 align-top'>
          <Input
            {...register(`rows.${index}.notes`)}
            aria-label={t('Notes')}
            placeholder={t('Notes')}
          />
        </TableCell>
        <TableCell className='align-top'>
          <div className='flex items-center gap-2'>
            <Switch
              checked={row.enabled}
              onCheckedChange={handleEnabledChange}
              aria-label={t('Enable pricing rule')}
            />
            <Button
              type='button'
              size='xs'
              variant='destructive'
              onClick={handleRemove}
            >
              {t('Delete')}
            </Button>
          </div>
        </TableCell>
      </TableRow>
    )
  }
)
