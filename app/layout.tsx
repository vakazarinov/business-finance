import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Business Finance",
  description: "Семейное приложение для учёта финансов",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
