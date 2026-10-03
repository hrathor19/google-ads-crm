import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: '',
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 4px)',
      },
      boxShadow: {
        // A material elevation scale. Each level is TWO shadows: a tight,
        // near-opaque one for the contact edge and a wide, soft one for the
        // cast. A single blurred shadow reads as a grey smudge; the pair is
        // what makes a surface look lifted rather than merely outlined.
        // Tinted with the page's ink colour rather than pure black, so it
        // sits in the palette instead of greying it.
        'elevation-1':
          '0 1px 2px -1px hsl(222 47% 20% / 0.06), 0 1px 3px 0 hsl(222 47% 20% / 0.05)',
        'elevation-2':
          '0 2px 4px -2px hsl(222 47% 20% / 0.07), 0 6px 16px -4px hsl(222 47% 20% / 0.09)',
        'elevation-3':
          '0 4px 8px -3px hsl(222 47% 20% / 0.08), 0 14px 32px -6px hsl(222 47% 20% / 0.13)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'bell-shake': {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '10%, 50%, 90%': { transform: 'rotate(-15deg)' },
          '30%, 70%': { transform: 'rotate(15deg)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'gradient-move': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        'shimmer-sweep': {
          '0%': { left: '-40%' },
          '100%': { left: '140%' },
        },
        'float-particle': {
          '0%': { transform: 'translateY(0) scale(0.7)', opacity: '0' },
          '15%': { opacity: '1' },
          '85%': { opacity: '1' },
          '100%': { transform: 'translateY(-34px) scale(1)', opacity: '0' },
        },
        'pulse-glow': {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.5' },
          '50%': { transform: 'scale(1.25)', opacity: '0.85' },
        },
        // Grows out of the launcher rather than appearing over it: the
        // transform-origin is set on the element, so the panel reads as the
        // button unfolding.
        'panel-in': {
          from: { opacity: '0', transform: 'translateY(14px) scale(0.92)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'panel-out': {
          from: { opacity: '1', transform: 'translateY(0) scale(1)' },
          to: { opacity: '0', transform: 'translateY(10px) scale(0.95)' },
        },
        'bubble-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'typing-dot': {
          '0%, 60%, 100%': { transform: 'translateY(0)', opacity: '0.35' },
          '30%': { transform: 'translateY(-4px)', opacity: '1' },
        },
        'caret-blink': {
          '0%, 45%': { opacity: '1' },
          '55%, 100%': { opacity: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'bell-shake': 'bell-shake 0.8s ease-in-out',
        'fade-in': 'fade-in 0.4s ease-out both',
        'fade-in-up': 'fade-in-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        'gradient-move': 'gradient-move 6s ease infinite',
        'shimmer-sweep': 'shimmer-sweep 3.5s ease-in-out infinite',
        'float-particle': 'float-particle 4s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2.4s ease-in-out infinite',
        'panel-in': 'panel-in 0.26s cubic-bezier(0.22, 1, 0.36, 1) both',
        'panel-out': 'panel-out 0.16s cubic-bezier(0.4, 0, 1, 1) both',
        'bubble-in': 'bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both',
        'typing-dot': 'typing-dot 1.2s ease-in-out infinite',
        'caret-blink': 'caret-blink 1s step-end infinite',
      },
      transitionTimingFunction: {
        premium: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
