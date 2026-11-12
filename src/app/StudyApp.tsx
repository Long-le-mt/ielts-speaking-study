import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/ui/Button";
import { LibrarySidebar } from "../features/library/LibrarySidebar";
import { LoadedLesson as Lesson } from "../features/lesson/LoadedLesson";
import { filterLibrary, type Episode, type LibraryFilters } from "../lib/library";
import { watchRelease } from "../lib/release";

interface StudyAppProps {
  episodes: Episode[];
  filters: LibraryFilters;
  requestedSlug?: string;
  onFilterChange: (filters: LibraryFilters, slug?: string) => void;
  onSelect: (slug: string) => void;
}

const mobileQuery = "(max-width: 800px)";

function getDesktopPreference() {
  try {
    return localStorage.getItem("ielts-sidebar-open") !== "false";
  } catch {
    return true;
  }
}

export function StudyApp({ episodes, filters, requestedSlug, onFilterChange, onSelect }: StudyAppProps) {
  const [mobile, setMobile] = useState(() => window.matchMedia(mobileQuery).matches);
  const [desktopOpen, setDesktopOpen] = useState(getDesktopPreference);
  const [mobileOpen, setMobileOpen] = useState(false);
  const lessonRef = useRef<HTMLElement>(null);
  const sidebarOpen = mobile ? mobileOpen : desktopOpen;
  const modalOpen = mobile && sidebarOpen;

  useEffect(() => {
    const query = window.matchMedia(mobileQuery);
    const update = () => {
      setMobile(query.matches);
      setMobileOpen(false);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("sidebar-open", modalOpen);
    return () => document.body.classList.remove("sidebar-open");
  }, [modalOpen]);

  useEffect(() => watchRelease(url => {
    const lesson = lessonRef.current;
    const slug = lesson?.dataset.lessonSlug;
    const audio = lesson?.querySelector("audio");
    if (slug) url.searchParams.set("lesson", slug);
    if (!slug || !audio || !Number.isFinite(audio.currentTime)) return;
    try {
      sessionStorage.setItem("ielts-playback", JSON.stringify({ slug, time: audio.currentTime }));
    } catch {
      // An update can still load when browser storage is unavailable.
    }
    audio.pause();
  }), []);

  const filterValues = useMemo(() => ({
    parts: new Set(episodes.map(episode => episode.category)),
    sources: new Set(episodes.map(episode => episode.publisher)),
    years: new Set(episodes.map(episode => episode.year)),
    hasAlignment: episodes.some(episode => episode.hasAlignment),
  }), [episodes]);
  const validFilters = useMemo(() => ({
    q: filters.q,
    part: filters.part && filterValues.parts.has(filters.part) ? filters.part : undefined,
    source: filters.source && filterValues.sources.has(filters.source) ? filters.source : undefined,
    year: filters.year && filterValues.years.has(filters.year) ? filters.year : undefined,
    availability: filters.availability === "synced" && !filterValues.hasAlignment
      ? undefined
      : filters.availability,
  }), [filterValues, filters.q, filters.part, filters.source, filters.year, filters.availability]);
  const visible = useMemo(() => filterLibrary(episodes, validFilters), [episodes, validFilters]);
  const active = visible.find(episode => episode.slug === requestedSlug) ?? visible[0];

  function setSidebar(open: boolean) {
    if (mobile) {
      setMobileOpen(open);
    } else {
      setDesktopOpen(open);
      try { localStorage.setItem("ielts-sidebar-open", String(open)); } catch {}
    }
  }

  function changeFilters(next: LibraryFilters) {
    const matches = filterLibrary(episodes, next);
    const slug = matches.find(episode => episode.slug === active?.slug)?.slug ?? matches[0]?.slug;
    onFilterChange(next, slug);
  }

  const selectLesson = useCallback((slug: string) => {
    if (mobile) setMobileOpen(false);
    onSelect(slug);
    requestAnimationFrame(() => lessonRef.current?.focus({ preventScroll: true }));
  }, [mobile, onSelect]);

  return (
    <>
      <a className="skip-link" href="#lesson" inert={modalOpen}>Skip to lesson</a>
      <header className="masthead" data-sidebar-open={sidebarOpen} inert={modalOpen}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">IE</span>
          <h1>IELTS Speaking</h1>
        </div>
        <Button
          id="toggle-sidebar"
          className="sidebar-toggle"
          aria-controls="library-browser"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebar(!sidebarOpen)}
        >
          <span className="sidebar-icon" aria-hidden="true" />
          <span className="sidebar-toggle-label">{sidebarOpen ? "Hide filters" : "Show filters"}</span>
        </Button>
      </header>
      <div className={sidebarOpen ? "workspace" : "workspace sidebar-hidden"}>
        <LibrarySidebar
          episodes={episodes}
          visibleEpisodes={visible}
          activeSlug={active?.slug}
          filters={validFilters}
          onFilterChange={changeFilters}
          onSelect={selectLesson}
          open={sidebarOpen}
          mobile={mobile}
          onClose={() => setSidebar(false)}
        />
        <main
          id="lesson"
          className="lesson"
          tabIndex={-1}
          ref={lessonRef}
          inert={modalOpen}
          aria-labelledby={active ? "lesson-title" : undefined}
          data-lesson-slug={active?.slug}
        >
          {active ? <Lesson key={active.slug} episode={active} /> : (
            <p className="notice" role="status">
              {episodes.length ? "No topics match these filters." : "No topics are available yet."}
            </p>
          )}
        </main>
      </div>
    </>
  );
}
