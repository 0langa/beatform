import React from "react";
import ReactDOM from "react-dom/client";
import { PerformApp } from "./PerformApp";

/**
 * FEAT-009 — entry for the performance-output window. Loaded DYNAMICALLY by
 * main.tsx (label/`?perform` branch), so the store/persistence modules are
 * never evaluated here: exactly one window writes localStorage and the
 * autosave file, by construction.
 */
export function mountPerform(rootEl: HTMLElement): void {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <PerformApp />
    </React.StrictMode>,
  );
}
