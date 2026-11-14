import type { ReactNode } from "react";

export const metadata = {
  title: "Graveyard Shift",
  description: "Dead code, raised overnight, with proof you can verify.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
