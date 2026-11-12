import { createRootRoute, Outlet, useRouter } from "@tanstack/react-router";
import { Button } from "../components/ui/Button";

export const Route = createRootRoute({
  component: Outlet,
  pendingMs: 0,
  pendingMinMs: 0,
  pendingComponent: () => <main className="initial-status" role="status">Loading your study library…</main>,
  errorComponent: LibraryError,
  notFoundComponent: () => (
    <main className="initial-status">
      <h1>Page not found</h1>
      <a href={import.meta.env.BASE_URL}>Open the study library</a>
    </main>
  ),
});

function LibraryError() {
  const router = useRouter();
  return (
    <main className="initial-status">
      <h1>Library unavailable</h1>
      <p>Could not load the study library.</p>
      <Button onClick={() => void router.invalidate()}>Try again</Button>
    </main>
  );
}
