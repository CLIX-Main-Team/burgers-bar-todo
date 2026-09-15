import type { ProjectColour, ProjectSummary } from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Dialog } from '../../components/ui/dialog.js'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '../../components/ui/dropdown-menu.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { projectsApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import {
  PROJECT_COLOURS,
  PROJECT_FILL,
  PROJECT_INK,
  PROJECT_PHASES,
  PROJECT_PHASE_INK,
  PROJECT_PHASE_LABEL_KEY,
  usePhaseLook,
} from './project-look.js'
import { PROJECTS_QUERY_KEY, projectDetailKey } from './project-queries.js'

// The project's status on its own page, and the way to change it (owner ask 2026-09-15: "it should
// be a dropdown where we can change its status ... we should also be able to add custom status").
//
// The trigger IS the pill, not a pill with a select beside it: the thing you read and the thing you
// press are one object, and it highlights under the pointer the way the dialog's bare values do,
// with no chevron (the owner's standing call on those). Somebody who cannot author the project gets
// the same pill as plain text, because a control that refuses every press is worse than none.
//
// The built-in stages come first in their fixed order, then this project's own statuses, each with
// its colour dot and a way to take it back off, then Add status for the chain owner.
export function ProjectPhaseMenu({
  project,
  canChange,
  canAddStatus,
}: {
  project: ProjectSummary
  canChange: boolean
  canAddStatus: boolean
}) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const look = usePhaseLook()(project)
  const [adding, setAdding] = useState(false)
  const [failed, setFailed] = useState(false)

  const refresh = () => {
    setFailed(false)
    queryClient.invalidateQueries({ queryKey: projectDetailKey(project.id) })
    queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY })
  }

  const setMutation = useMutation({
    mutationFn: (phase: string) => projectsApi.setPhase(project.id, phase),
    onSuccess: refresh,
    onError: () => setFailed(true),
  })
  const removeMutation = useMutation({
    mutationFn: (phaseId: string) => projectsApi.removeCustomPhase(project.id, phaseId),
    onSuccess: refresh,
    onError: () => setFailed(true),
  })

  if (!canChange) return <PhaseMark ink={look.ink} label={look.label} />

  const busy = setMutation.isPending || removeMutation.isPending

  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu
        label={t('projects.changeStatus')}
        align="end"
        trigger={(props) => (
          <button
            {...props}
            type="button"
            disabled={busy}
            aria-label={`${t('projects.changeStatus')}: ${look.label}`}
            // The dropdown idiom the dialog's values use: bare until the pointer is on it, then a
            // muted ground behind it, and no chevron.
            className="inline-flex h-8 items-center rounded-md px-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <PhaseMark ink={look.ink} label={look.label} />
          </button>
        )}
      >
        <div className="py-1">
          {PROJECT_PHASES.map((phase) => (
            <DropdownMenuRadioItem
              key={phase}
              checked={project.phase === phase}
              onSelect={() => setMutation.mutate(phase)}
              hideCheck
            >
              <PhaseDot ink={PROJECT_PHASE_INK[phase]} />
              {t(PROJECT_PHASE_LABEL_KEY[phase])}
            </DropdownMenuRadioItem>
          ))}

          {project.customPhases.length > 0 && <DropdownMenuSeparator />}
          {project.customPhases.map((phase) => (
            // The remove button sits BESIDE the row, not inside it — a button inside a button is
            // invalid markup and swallows the row's own press on some browsers.
            <div key={phase.id} className="group/phase flex items-center gap-0.5">
              <DropdownMenuRadioItem
                checked={project.phase === phase.id}
                onSelect={() => setMutation.mutate(phase.id)}
                hideCheck
                className="min-w-0 flex-1"
              >
                <PhaseDot ink={PROJECT_INK[phase.colour]} />
                <bdi className="truncate">{phase.name}</bdi>
              </DropdownMenuRadioItem>
              {canAddStatus && (
                <DropdownMenuItem
                  onSelect={() => removeMutation.mutate(phase.id)}
                  aria-label={t('projects.removeStatus', { name: phase.name })}
                  tone="destructive"
                  className="w-auto flex-none justify-center px-2 text-muted-foreground"
                >
                  <Icon name="close" size="sm" />
                </DropdownMenuItem>
              )}
            </div>
          ))}

          {canAddStatus && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setAdding(true)} className="text-muted-foreground">
                <Icon name="create" size="sm" />
                {t('projects.addStatus')}
              </DropdownMenuItem>
            </>
          )}
        </div>
      </DropdownMenu>

      {failed && (
        <p role="alert" className="text-caption text-destructive">
          {t('projects.statusFailed')}
        </p>
      )}

      {adding && (
        <AddStatusDialog
          projectId={project.id}
          startColour={project.colour}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false)
            refresh()
          }}
        />
      )}
    </div>
  )
}

// A status as it reads everywhere: a dot and the word, both in the status's own ink.
export function PhaseMark({
  ink,
  label,
  className,
}: {
  ink: string
  label: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-[14rem] items-center gap-1.5 text-caption font-bold',
        ink,
        className,
      )}
    >
      <span aria-hidden="true" className="size-2 flex-none rounded-full bg-current" />
      <bdi className="truncate">{label}</bdi>
    </span>
  )
}

// The dot alone, for the rows of a menu, where the word beside it keeps the menu's own ink.
function PhaseDot({ ink }: { ink: string }) {
  return (
    <span aria-hidden="true" className={cn('inline-flex flex-none', ink)}>
      <span className="size-2.5 rounded-full bg-current" />
    </span>
  )
}

// Naming a status: a word and a colour, nothing else. The colour starts on the project's own so a
// person in a hurry gets a status that belongs to the project it was made on.
function AddStatusDialog({
  projectId,
  startColour,
  onClose,
  onAdded,
}: {
  projectId: string
  startColour: ProjectColour
  onClose: () => void
  onAdded: () => void
}) {
  const t = useTranslations()
  const nameId = useId()
  const [name, setName] = useState('')
  const [colour, setColour] = useState<ProjectColour>(startColour)
  const addMutation = useMutation({
    mutationFn: () => projectsApi.addCustomPhase(projectId, name.trim(), colour),
    onSuccess: onAdded,
  })

  return (
    <Dialog open onClose={onClose} title={t('projects.newStatusTitle')} className="max-w-[24rem]">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim()) addMutation.mutate()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className="text-label font-semibold text-foreground">
            {t('projects.statusName')}
          </label>
          <Input
            id={nameId}
            dir="auto"
            autoFocus
            maxLength={40}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('projects.statusNamePlaceholder')}
            className="h-10 border-0 bg-muted shadow-none"
          />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-label font-semibold text-foreground">
            {t('projects.statusColour')}
          </legend>
          <div className="flex flex-wrap items-center gap-2">
            {PROJECT_COLOURS.map((one) => (
              <label
                key={one}
                title={t(`projects.colour${one[0]?.toUpperCase()}${one.slice(1)}`)}
                className={cn(
                  'size-7 cursor-pointer rounded-full transition',
                  PROJECT_FILL[one],
                  colour === one
                    ? 'ring-2 ring-foreground ring-offset-2 ring-offset-card'
                    : 'hover:ring-2 hover:ring-border-strong hover:ring-offset-2 hover:ring-offset-card',
                  'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-card',
                )}
              >
                <input
                  type="radio"
                  name="status-colour"
                  className="sr-only"
                  checked={colour === one}
                  onChange={() => setColour(one)}
                  aria-label={t(`projects.colour${one[0]?.toUpperCase()}${one.slice(1)}`)}
                />
              </label>
            ))}
          </div>
          {/* The chip as it will look, so the colour is chosen against the words it will carry. On
              its own line, so a long name does not land beside the swatches one day and under them
              the next. */}
          {name.trim() && (
            <PhaseMark ink={PROJECT_INK[colour]} label={name.trim()} className="max-w-full" />
          )}
        </fieldset>

        {addMutation.isError && <Alert tone="error">{t('projects.statusFailed')}</Alert>}

        <div className="flex items-center justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!name.trim() || addMutation.isPending}>
            {addMutation.isPending ? t('common.working') : t('projects.addStatus')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
