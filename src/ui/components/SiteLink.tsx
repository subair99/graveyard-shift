// Link built by src/ui/core/site.ts (never from File_Text). Plain anchor, no router, no target.
import type { ReactNode } from "react";

export function SiteLink({ href, external, children }: { href: string; external?: boolean; children: ReactNode }) {
  if (external === true) {
    return (
      <a href={href} rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return <a href={href}>{children}</a>;
}
