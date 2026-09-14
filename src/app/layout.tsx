import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = { title: "Navigator | Legal Document Workspace", description: "Understand your documents, find the terms that matter, and prepare for a conversation with a legal professional. Legal information, not professional advice." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
