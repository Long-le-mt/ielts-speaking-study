import { memo, useMemo, useRef } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Drawer } from '../../components/ui/Drawer'
import { SelectField, TextField } from '../../components/ui/Fields'
import { StatusMessage } from '../../components/ui/StatusMessage'
import type { Episode, LibraryFilters } from '../../lib/library'

interface LibrarySidebarProps {
  episodes: Episode[]
  visibleEpisodes: Episode[]
  activeSlug?: string
  filters: LibraryFilters
  onFilterChange: (filters: LibraryFilters) => void
  onSelect: (slug: string) => void
  open: boolean
  mobile: boolean
  onClose: () => void
  loading?: boolean
}

const shortDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' })

function filterOptions(values: (string | null | undefined)[], descending = false) {
  const unique = [...new Set(values.filter((value): value is string => Boolean(value)))]
  unique.sort((first, second) => first.localeCompare(second, 'en', { numeric: true }))
  if (descending) unique.reverse()
  return unique.map((value) => ({ value, label: value }))
}

const LessonListItem = memo(function LessonListItem({ episode, active, onSelect }: {
  episode: Episode
  active: boolean
  onSelect: (slug: string) => void
}) {
  return (
    <li>
      <button type="button" className="topic" aria-controls="lesson" aria-current={active || undefined} onClick={() => onSelect(episode.slug)}>
        <span className="topic-title">{episode.title}</span>
        <span className="topic-meta">
          <span className="topic-source">{episode.category} · {episode.publisher}</span>
          {episode.date && <time dateTime={episode.date.toISOString().slice(0, 10)}>{shortDate.format(episode.date)}</time>}
          {episode.audioUrl ? <Badge tone="mint" className="pill-ready">Audio</Badge> : episode.videoUrl && <Badge>Video</Badge>}
          {episode.alignment && <Badge tone="blue" className="pill-sync">Sentence sync</Badge>}
          <Badge tone={episode.hasTranscript ? 'mint' : 'neutral'} className={episode.hasTranscript ? 'pill-ready' : undefined}>
            {episode.hasTranscript ? 'Transcript' : 'No transcript'}
          </Badge>
        </span>
      </button>
    </li>
  )
})

export function LibrarySidebar({
  episodes, visibleEpisodes, activeSlug, filters, onFilterChange, onSelect, open, mobile, onClose, loading = false,
}: LibrarySidebarProps) {
  const search = useRef<HTMLInputElement>(null)
  const options = useMemo(() => {
    const materials: { value: NonNullable<LibraryFilters['availability']>; label: string }[] = [
      { value: 'audio', label: 'Audio' },
      { value: 'video', label: 'YouTube' },
      { value: 'transcript', label: 'Transcript' },
      { value: 'missing', label: 'No transcript' },
    ]
    if (episodes.some((episode) => episode.alignment)) {
      materials.unshift({ value: 'synced', label: 'Synced' })
    }
    return {
      parts: filterOptions(episodes.map((episode) => episode.category)).map((option) => ({
        ...option,
        label: option.label.replace(/^Speaking Part /, 'Part '),
      })),
      sources: filterOptions(episodes.map((episode) => episode.publisher)),
      years: filterOptions(episodes.map((episode) => episode.year), true),
      materials,
    }
  }, [episodes])
  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <Drawer
      id="library-browser"
      title="Lessons & filters"
      open={open}
      modal={mobile}
      triggerId="toggle-sidebar"
      className="library"
      closeButtonId="close-sidebar"
      closeLabel="Hide filters"
      onClose={onClose}
    >
      <div className="library-content">
        <TextField
          ref={search}
          id="search"
          label="Search lessons"
          type="search"
          placeholder="Topic, part or source…"
          autoComplete="off"
          disabled={loading}
          value={filters.q ?? ''}
          onChange={(event) => onFilterChange({ ...filters, q: event.target.value || undefined })}
        />
        <div className="filters">
          <SelectField
            id="part"
            label="Speaking part"
            emptyLabel="All"
            options={options.parts}
            value={filters.part ?? ''}
            disabled={loading}
            onValueChange={(part) => onFilterChange({ ...filters, part })}
          />
          <SelectField
            id="publisher"
            label="Source"
            emptyLabel="All"
            options={options.sources}
            value={filters.source ?? ''}
            disabled={loading}
            onValueChange={(source) => onFilterChange({ ...filters, source })}
          />
          <SelectField
            id="availability"
            label="Materials"
            emptyLabel="All"
            options={options.materials}
            value={filters.availability ?? ''}
            disabled={loading}
            onValueChange={(availability) => onFilterChange({ ...filters, availability })}
          />
          <SelectField
            id="year"
            label="Year"
            emptyLabel="All"
            options={options.years}
            value={filters.year ?? ''}
            disabled={loading}
            onValueChange={(year) => onFilterChange({ ...filters, year })}
          />
        </div>
        <div className="result-summary">
          <p id="topic-count" className="topic-count" role="status">
            {loading ? 'Loading topics…' : `${visibleEpisodes.length} of ${episodes.length} topics`}
          </p>
          {hasFilters && (
            <Button
              id="clear-filters"
              variant="quiet"
              size="compact"
              className="clear-filters"
              disabled={loading}
              onClick={() => {
                onFilterChange({})
                search.current?.focus()
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
        {!loading && visibleEpisodes.length === 0 && <StatusMessage kind="empty">No lessons match these filters.</StatusMessage>}
        <ul id="topic-list" className="topic-list" aria-label="Study topics">
          {visibleEpisodes.map((episode) => (
            <LessonListItem key={episode.slug} episode={episode} active={episode.slug === activeSlug} onSelect={onSelect} />
          ))}
        </ul>
      </div>
    </Drawer>
  )
}
