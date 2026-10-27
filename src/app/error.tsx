"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Root error boundary.
 *
 * Unexpected exceptions (database errors, serialisation problems) must not show
 * their raw message to end users - it can contain SQL, column names or connection
 * details. In production only a generic note plus the digest is shown; the full
 * error is logged on the server and in the browser console for support.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  const showDetails = process.env.NODE_ENV !== "production";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
      <p className="max-w-lg text-sm text-slate-600">
        The action could not be completed and nothing was changed in the database. Try again - if it
        keeps happening, send the reference below to your administrator.
      </p>
      {showDetails ? (
        <pre className="max-w-lg overflow-auto rounded-md bg-slate-100 p-3 text-left text-xs text-slate-700">
          {error.message}
          {error.digest ? `\n(digest: ${error.digest})` : ""}
        </pre>
      ) : null}
      {error.digest ? (
        <p className="text-xs text-slate-400">Reference: {error.digest}</p>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={reset} variant="primary" size="sm">
          Try again
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href="/dashboard">Back to dashboard</a>
        </Button>
      </div>
    </div>
  );
}
