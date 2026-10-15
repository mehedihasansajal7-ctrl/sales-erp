"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

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

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
      <p className="max-w-lg text-sm text-slate-600">
        The action could not be completed. The business rule that blocked it is shown below — nothing
        was changed in the database.
      </p>
      <pre className="max-w-lg overflow-auto rounded-md bg-slate-100 p-3 text-left text-xs text-slate-700">
        {error.message}
        {error.digest ? `\n(digest: ${error.digest})` : ""}
      </pre>
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
