import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        /* Surfaces */
        canvas: "#F5F6F4",
        paper: "#FFFFFF",
        sunken: "#FAFAF9",
        /* Lines */
        line: "#E2E4E7",
        hair: "#EEF0F2",
        /* Ink */
        ink: "#0B0C0E",
        ash: "#5C626B",
        mute: "#8B919B",
        faint: "#B4B9C0",
        /* Signal */
        accent: "#0F3DDE",
        allow: "#0B7A4B",
        block: "#CE2F26",
        halt: "#8E120C",
      },
      letterSpacing: {
        label: "0.18em",
        wider2: "0.26em",
      },
      boxShadow: {
        panel: "0 1px 2px rgba(11,12,14,0.04)",
        lift: "0 8px 24px -12px rgba(11,12,14,0.18)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "dot-pulse": { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.25" } },
        sweep: { "0%": { left: "-40%" }, "100%": { left: "100%" } },
        "bar-grow": { from: { transform: "scaleX(0)" }, to: { transform: "scaleX(1)" } },
      },
      animation: {
        "fade-up": "fade-up 260ms cubic-bezier(0.22,0.61,0.36,1) both",
        "fade-in": "fade-in 220ms ease-out both",
        "dot-pulse": "dot-pulse 1.8s ease-in-out infinite",
        sweep: "sweep 1.3s cubic-bezier(0.4,0,0.2,1) infinite",
        "bar-grow": "bar-grow 520ms cubic-bezier(0.22,0.61,0.36,1) both",
      },
    },
  },
  plugins: [],
} satisfies Config;
