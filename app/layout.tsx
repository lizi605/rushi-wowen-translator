import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "「如是我闻」翻译器｜译经成文，解经还意",
  description:
    "输入一句寻常话，把它翻译成佛经体的白话翻译腔；也可粘贴佛经体，解经翻回直接人话。",
  keywords: ["佛经体", "佛说体", "「如是我闻」翻译器", "解经", "AI翻译", "网络梗", "DeepSeek"],
  openGraph: {
    title: "「如是我闻」翻译器",
    description: "译经成文，解经还意。",
    type: "website",
    locale: "zh_CN",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
