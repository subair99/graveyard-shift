// The only component that turns File_Text into an anchor (crypt-ui Requirements 7.2, 7.3, 7.6).
import type { ReactNode } from "react";
import { safeHref } from "../core/safeHref";

export function SafeLink({ value, children }: { value: string; children?: ReactNode }) {
  const href = safeHref(value);
  if (href === null) return <>{children ?? value}</>;
  return (
    <a href={href} rel="noopener noreferrer">
      {children ?? value}
    </a>
  );
}
