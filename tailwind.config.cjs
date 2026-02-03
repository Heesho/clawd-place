/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./pages/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"]
      },
      colors: {
        ink: "#0b0d12",
        night: "#12151c",
        neon: "#67ffbb",
        ember: "#ffb454",
        fog: "#b8c0cc"
      },
      boxShadow: {
        glow: "0 0 40px rgba(103, 255, 187, 0.2)"
      }
    }
  },
  plugins: []
};
