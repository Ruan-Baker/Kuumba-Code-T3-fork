import { createRootRoute, Outlet } from "@tanstack/react-router";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { ToastContainer } from "~/components/Toast";
import { useTheme } from "~/lib/useTheme";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  useTheme();

  return (
    <ErrorBoundary>
      <div
        className="flex w-full flex-col overflow-hidden bg-background text-foreground"
        style={{
          height: "100dvh",
          maxHeight: "100dvh",
          paddingTop: "var(--safe-area-top)",
          paddingBottom: "var(--safe-area-bottom)",
          paddingLeft: "var(--safe-area-left)",
          paddingRight: "var(--safe-area-right)",
        }}
      >
        <Outlet />
      </div>
      <ToastContainer />
    </ErrorBoundary>
  );
}
