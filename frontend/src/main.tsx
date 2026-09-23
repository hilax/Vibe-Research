import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { useLightTheme } from "./hooks/useLightTheme";
import { router } from "./router";
import "./index.css";

function ThemeToaster() {
  const light = useLightTheme();
  return <Toaster position="bottom-right" theme={light ? "light" : "dark"} richColors closeButton duration={3500} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
      <ThemeToaster />
    </ErrorBoundary>
  </StrictMode>
);
