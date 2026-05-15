import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{vue,ts,tsx,js,jsx}'],
  darkMode: ['class', '[data-theme="night"]'],
  theme: {
    extend: {
      colors: {
        /* Legacy ink palette — re-pointed to dark cổ phong values. */
        ink: {
          50: '#f0e6cc',
          100: '#fff6e0',
          300: '#c9a45a',
          500: '#8c6f30',
          700: '#1a2028',
          900: '#0e1318',
        },
        /* Cửu Thiên Mộng — primary group accents. */
        jade: {
          deep: '#1b3b34',
          base: '#2a6a5a',
          DEFAULT: '#3da98f',
          bright: '#5fe3c6',
        },
        mist: {
          deep: '#1f3344',
          base: '#3a5d7a',
          DEFAULT: '#6fa3c6',
          bright: '#b9d6e8',
        },
        gold: {
          deep: '#4a3b18',
          base: '#8c6f30',
          DEFAULT: '#c9a45a',
          bright: '#f2d789',
        },
        seal: {
          deep: '#5a1c1c',
          base: '#882a2a',
          DEFAULT: '#b23b3b',
          bright: '#d04f4f',
        },
        smoke: {
          deep: '#2a2540',
          base: '#4d4575',
          DEFAULT: '#7e73b0',
          bright: '#a99fd4',
        },
        scroll: {
          deep: '#1f1a13',
          base: '#2a2418',
          mid: '#3b3220',
          paper: '#f0e6cc',
          bright: '#fff6e0',
        },
      },
      fontFamily: {
        co: ['"Noto Serif SC"', '"LXGW WenKai TC"', '"Songti SC"', 'serif'],
        display: ['"Noto Serif SC"', '"LXGW WenKai TC"', '"Songti SC"', 'serif'],
        decorative: ['"Ma Shan Zheng"', '"LXGW WenKai TC"', '"Noto Serif SC"', 'serif'],
        body: ['"Noto Sans SC"', '"Noto Sans"', '"Inter"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'seal-glow': '0 0 24px rgba(208, 79, 79, 0.35)',
        'jade-glow': '0 0 28px rgba(95, 227, 198, 0.32)',
        'gold-glow': '0 0 32px rgba(242, 215, 137, 0.32)',
      },
    },
  },
  plugins: [],
} satisfies Config;
