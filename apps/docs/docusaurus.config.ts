import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import type * as Redocusaurus from "redocusaurus";

const config: Config = {
  title: "Exchequer",
  tagline: "Modern double-entry ledger API",
  favicon: "img/favicon.ico",
  url: "https://docs.exchequer.io",
  baseUrl: "/",
  organizationName: "exchequerio",
  projectName: "monorepo",
  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },
  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
    [
      "redocusaurus",
      {
        specs: [
          {
            id: "ledger-api",
            spec: "static/openapi.json",
            route: "/api/",
          },
        ],
        theme: {
          primaryColor: "#1890ff",
        },
      } satisfies Redocusaurus.PresetEntry,
    ],
  ],
  themeConfig: {
    navbar: {
      title: "Exchequer",
      items: [
        {
          type: "docSidebar",
          sidebarId: "tutorialSidebar",
          position: "left",
          label: "Docs",
        },
        {
          to: "/api/",
          position: "left",
          label: "API Reference",
        },
        {
          href: "https://github.com/exchequerio/monorepo",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      copyright: `Copyright © ${new Date().getFullYear()} Exchequer.`,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
