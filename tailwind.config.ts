import type { Config } from 'tailwindcss';

/**
 * Revive design tokens.
 *
 * The palette is built from oxidised metals — brass, verdigris, iron rust —
 * because the product is software archaeology: dating a specimen from the
 * evidence it carries. It deliberately avoids the black-plus-acid-green
 * "hacker terminal" register; the ground is a deep slate blue closer to
 * museum storage or a blueprint than a console.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: 'rgb(var(--ground) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        sunken: 'rgb(var(--sunken) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        faint: 'rgb(var(--faint) / <alpha-value>)',
        brass: 'rgb(var(--brass) / <alpha-value>)',
        verdigris: 'rgb(var(--verdigris) / <alpha-value>)',
        rust: 'rgb(var(--rust) / <alpha-value>)',
        blueprint: 'rgb(var(--blueprint) / <alpha-value>)',
      },
      fontFamily: {
        // Mono is the DISPLAY face here, not just the code face: the whole
        // interface reads as specimen labels and instrument readouts.
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'SF Mono',
          'Cascadia Code',
          'Segoe UI Mono',
          'Roboto Mono',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
        sans: [
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      letterSpacing: {
        label: '0.14em',
        display: '-0.03em',
      },
      borderRadius: {
        sm: '3px',
        DEFAULT: '4px',
        md: '6px',
        lg: '10px',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'strata-fill': {
          from: { transform: 'scaleY(0)' },
          to: { transform: 'scaleY(1)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        sweep: {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(300%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'strata-fill': 'strata-fill 400ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'pulse-soft': 'pulse-soft 1.8s ease-in-out infinite',
        sweep: 'sweep 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
