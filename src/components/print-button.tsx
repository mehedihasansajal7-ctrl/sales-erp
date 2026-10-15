"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the browser print dialog for the surrounding print area. */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button type="button" variant="primary" size="sm" onClick={() => window.print()}>
      <Printer className="size-4" />
      {label}
    </Button>
  );
}
