import type { ReactNode } from "react";
import "./globals.css";
import { sitePath } from "../ui/core/site";
import { SITE_TITLE, UI } from "../ui/core/texts";
import { SiteLink } from "../ui/components/SiteLink";

export const metadata = {
  title: SITE_TITLE,
  description: "Dead code, raised overnight, with proof you can verify.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          {UI.skipLink}
        </a>
        <header>
          <nav aria-label={UI.navLabel}>
            <SiteLink href={sitePath("/")}>{UI.homeNav}</SiteLink>{" "}
            <SiteLink href={sitePath("/crypt/")}>{UI.cryptNav}</SiteLink>
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer>
          <p>{SITE_TITLE}. MIT license.</p>
        </footer>
      </body>
    </html>
  );
}
