import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import NavBar from "@/components/NavBar";
import "@/styles/globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-data",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Karion — Markets Resolved by Consensus",
  description:
    "Stake GEN on real-world outcomes. Karion uses GenLayer to search evidence, reason through uncertainty, and settle markets by consensus.",
  keywords: ["prediction market", "GenLayer", "consensus", "GEN", "StudioNet"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${ibmPlexMono.variable}`}
    >
      <body>
        <NavBar />
        <div className="pt-16">{children}</div>
      </body>
    </html>
  );
}
