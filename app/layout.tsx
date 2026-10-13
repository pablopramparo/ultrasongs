import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "./i18n/I18nProvider";
import UpdateProgress from "./components/UpdateProgress";
import { getRequestLang } from "./i18n/server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ultrastar Song Creator",
  description: "Generate Ultrastar Deluxe karaoke files from any audio or video.",
  icons: { icon: "/favico.png" },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const lang = await getRequestLang();

  return (
    <html
      lang={lang}
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider initialLang={lang}>
          {children}
          <UpdateProgress />
        </I18nProvider>
      </body>
    </html>
  );
}
