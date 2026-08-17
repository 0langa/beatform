import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ui/ErrorBoundary";

/** The main (operator) window's mount — main.tsx's default branch. Split
 * into its own module so the performance window's branch (FEAT-009) never
 * evaluates the store/persistence side effects this import graph carries. */
export function mountApp(rootEl: HTMLElement): void {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
