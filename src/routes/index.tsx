import { useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { StudyApp } from "../app/StudyApp";
import { loadLibrary, type LibraryFilters } from "../lib/library";

interface StudySearch extends LibraryFilters {
  lesson?: string;
  sync?: 1;
  v?: string;
}

function searchText(value: unknown, limit: number) {
  return typeof value === "string" && value.length <= limit && value ? value : undefined;
}

function validateSearch(search: Record<string, unknown>): StudySearch {
  const { availability, year } = search;
  return {
    lesson: searchText(search.lesson, 256),
    q: searchText(search.q, 256),
    part: searchText(search.part, 120),
    source: searchText(search.source, 120),
    availability: availability === "audio" || availability === "video" ||
      availability === "transcript" || availability === "missing" || availability === "synced"
      ? availability : undefined,
    year: /^\d{4}$/.test(String(year)) ? String(year) : undefined,
    sync: search.sync === 1 || search.sync === "1" ? 1 : undefined,
    v: searchText(search.v, 100),
  };
}

export const Route = createFileRoute("/")({
  validateSearch,
  loader: loadLibrary,
  staleTime: Infinity,
  component: StudyRoute,
});

function StudyRoute() {
  const episodes = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const selectLesson = useCallback((slug: string) => {
    void navigate({ search: previous => ({ ...previous, lesson: slug }) });
  }, [navigate]);

  return (
    <StudyApp
      episodes={episodes}
      requestedSlug={search.lesson}
      filters={{ ...search, availability: search.availability ?? (search.sync ? "synced" : undefined) }}
      onFilterChange={(filters, slug) => void navigate({
        search: { ...filters, lesson: slug, v: search.v },
        replace: true,
      })}
      onSelect={selectLesson}
    />
  );
}
