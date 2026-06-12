/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{svelte,ts,html}'],
  theme: {
    extend: {},
  },
  plugins: [],
  // Prevent Tailwind from resetting Obsidian's built-in styles
  corePlugins: {
    preflight: false,
  },
};
