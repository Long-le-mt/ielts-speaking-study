import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "./styles/theme.css";

const basepath = import.meta.env.BASE_URL;
if (window.location.pathname === `${basepath}index.html`) {
  const url = new URL(window.location.href);
  url.pathname = basepath;
  window.history.replaceState(window.history.state, "", url);
}

const router = createRouter({ routeTree, basepath });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
