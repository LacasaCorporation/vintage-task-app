import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { AppDialogsProvider } from "@/components/AppDialogs";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// Lazy load route components for better code splitting
//
// A route chunk that fails to fetch ("Failed to fetch dynamically imported
// module") is almost never a bug in the route: it means the browser asked for
// that JS and didn't get it back — a stale cached entry, or a dev server that
// was rebuilding when the request landed. Reloading once gets a fresh module
// graph; the session guard means a genuinely missing module can never put the
// page in a reload loop, and any chunk that loads clears the guard so a later
// failure is still free to retry.
const ROUTE_RELOAD_GUARD = "slate:route-reload";

function lazyRoute<P>(loader: () => Promise<{ default: React.ComponentType<P> }>) {
  return lazy(() =>
    loader().then(
      (mod) => {
        window.sessionStorage.removeItem(ROUTE_RELOAD_GUARD);
        return mod;
      },
      (error: unknown) => {
        if (window.sessionStorage.getItem(ROUTE_RELOAD_GUARD) === null) {
          window.sessionStorage.setItem(ROUTE_RELOAD_GUARD, "1");
          console.warn("Route chunk failed to load; reloading once.", error);
          window.location.reload();
          // the reload replaces this page, so this never settles
          return new Promise<never>(() => {});
        }
        throw error;
      },
    ),
  );
}

const Landing = lazyRoute(() => import("./pages/Landing.tsx"));
const AuthPage = lazyRoute(() => import("./pages/Auth.tsx"));
const Dashboard = lazyRoute(() => import("./pages/Dashboard.tsx"));
const SalesDocumentPage = lazyRoute(
  () => import("./pages/SalesDocumentPage.tsx"),
);
const MaterialPage = lazyRoute(() => import("./pages/MaterialPage.tsx"));
const ProductPage = lazyRoute(() => import("./pages/ProductPage.tsx"));
const CostingPage = lazyRoute(() => import("./pages/CostingPage.tsx"));
const UnitsCategoriesPage = lazyRoute(
  () => import("./pages/UnitsCategoriesPage.tsx"),
);
const NotFound = lazyRoute(() => import("./pages/NotFound.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in WebContainer environment). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
        <div className="max-w-lg text-center">
          <p className="text-sm font-semibold">Preview runtime error</p>
          <p className="mt-2 text-xs text-muted-foreground break-words">
            {this.state.message}
          </p>
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => {
                window.sessionStorage.removeItem(ROUTE_RELOAD_GUARD);
                window.location.reload();
              }}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
            >
              Reload
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground/80">
            A route that fails to load is usually a stale cached file rather
            than a problem with the page — reloading fetches the current one.
          </p>
          {this.state.stack && (
            <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
              {this.state.stack}
            </pre>
          )}
        </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);



function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <AppDialogsProvider>
          <BrowserRouter>
            <RouteSyncer />
            <Suspense fallback={<RouteLoading />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route
                  path="/auth"
                  element={<AuthPage redirectAfterAuth="/dashboard" />}
                />
                <Route
                  path="/dashboard"
                  element={
                    <RequireAuth>
                      <Dashboard />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/sales/:section/:id?"
                  element={
                    <RequireAuth>
                      <SalesDocumentPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/products/:id?"
                  element={
                    <RequireAuth>
                      <ProductPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/costing/:fgId"
                  element={
                    <RequireAuth>
                      <CostingPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/materials/:id?"
                  element={
                    <RequireAuth>
                      <MaterialPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/units-categories"
                  element={
                    <RequireAuth>
                      <UnitsCategoriesPage />
                    </RequireAuth>
                  }
                />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AppDialogsProvider>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
